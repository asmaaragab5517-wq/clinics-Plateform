locals {
  name = "healthflow-${var.environment}"
  common_env = {
    NODE_ENV           = "production"
    PUBLIC_SITE_URL    = "https://${var.site_domain}"
    CONSOLE_URL        = "https://${var.console_domain}"
    API_PUBLIC_URL     = "https://${var.api_domain}"
    CORS_ORIGINS       = "https://${var.site_domain},https://${var.console_domain}"
    KEYCLOAK_ISSUER    = var.keycloak_issuer
    KEYCLOAK_AUDIENCE  = "healthflow-api"
    HEALTHPAY_MODE     = "http"
    CEQUENS_MODE       = "http"
    STORAGE_MODE       = "s3"
    S3_ENDPOINT        = "https://${var.region}.digitaloceanspaces.com"
    S3_REGION          = var.region
    S3_BUCKET          = digitalocean_spaces_bucket.private.name
    AV_MODE            = "clamd"
    CLAMD_HOST         = "clamav"
    CHROMIUM_PATH      = "/usr/bin/chromium"
  }
}

resource "digitalocean_vpc" "main" {
  name     = "${local.name}-vpc"
  region   = var.region
  ip_range = var.environment == "production" ? "10.20.0.0/16" : "10.30.0.0/16"
}

# PostgreSQL 16 with PITR (managed), standby node and a read replica for reporting (NFR-3, NFR-4).
resource "digitalocean_database_cluster" "pg" {
  name                 = "${local.name}-pg"
  engine               = "pg"
  version              = "16"
  size                 = var.db_size
  region               = var.region
  node_count           = var.db_nodes
  private_network_uuid = digitalocean_vpc.main.id
  maintenance_window {
    day  = "friday"
    hour = "00:00:00" # 02:00 Cairo (NFR-1 maintenance window 02:00-05:00)
  }
}

resource "digitalocean_database_replica" "reporting" {
  cluster_id = digitalocean_database_cluster.pg.id
  name       = "${local.name}-pg-replica"
  size       = var.db_size
  region     = var.region
}

resource "digitalocean_database_db" "app" {
  cluster_id = digitalocean_database_cluster.pg.id
  name       = "healthflow"
}

resource "digitalocean_database_firewall" "pg" {
  cluster_id = digitalocean_database_cluster.pg.id
  rule {
    type  = "app"
    value = digitalocean_app.api.id
  }
}

resource "digitalocean_database_cluster" "redis" {
  name                 = "${local.name}-valkey"
  engine               = "valkey"
  version              = "8"
  size                 = "db-s-1vcpu-1gb"
  region               = var.region
  node_count           = 1
  private_network_uuid = digitalocean_vpc.main.id
}

# Private object storage for documents, signatures, exports (FR-EMR-6, SEC-4). No public ACL, no listing.
resource "digitalocean_spaces_bucket" "private" {
  name   = "${local.name}-private"
  region = var.region
  acl    = "private"
  versioning { enabled = true }
  lifecycle_rule {
    id      = "exports-expire"
    prefix  = "org/"
    enabled = true
    noncurrent_version_expiration { days = 30 }
  }
}

# API + worker + ClamAV on App Platform, images from GitHub Container Registry.
resource "digitalocean_app" "api" {
  spec {
    name   = "${local.name}-api"
    region = var.region

    domain {
      name = var.api_domain
      type = "PRIMARY"
    }

    service {
      name               = "api"
      instance_count     = var.api_instances
      instance_size_slug = "apps-d-1vcpu-2gb"
      http_port          = 4000
      image {
        registry_type = "GHCR"
        registry      = split("/", var.github_repo)[0]
        repository    = "${split("/", lower(var.github_repo))[1]}-api"
        tag           = var.image_tag
      }
      health_check { http_path = "/health" }
      dynamic "env" {
        for_each = local.common_env
        content {
          key   = env.key
          value = env.value
        }
      }
      env {
        key   = "DATABASE_URL"
        value = "postgresql://hf_api:${var.secrets["DATABASE_APP_PASSWORD"]}@${digitalocean_database_cluster.pg.private_host}:${digitalocean_database_cluster.pg.port}/healthflow?sslmode=require"
        type  = "SECRET"
      }
      env {
        key   = "REDIS_URL"
        value = digitalocean_database_cluster.redis.private_uri
        type  = "SECRET"
      }
      dynamic "env" {
        for_each = nonsensitive(toset(keys(var.secrets)))
        content {
          key   = env.value
          value = var.secrets[env.value]
          type  = "SECRET"
        }
      }
    }

    worker {
      name               = "worker"
      instance_count     = 1
      instance_size_slug = "apps-d-1vcpu-2gb"
      run_command        = "node apps/worker/dist/main.js"
      image {
        registry_type = "GHCR"
        registry      = split("/", var.github_repo)[0]
        repository    = "${split("/", lower(var.github_repo))[1]}-api"
        tag           = var.image_tag
      }
      dynamic "env" {
        for_each = local.common_env
        content {
          key   = env.key
          value = env.value
        }
      }
      env {
        key   = "DATABASE_URL"
        value = "postgresql://hf_api:${var.secrets["DATABASE_APP_PASSWORD"]}@${digitalocean_database_cluster.pg.private_host}:${digitalocean_database_cluster.pg.port}/healthflow?sslmode=require"
        type  = "SECRET"
      }
      env {
        key   = "REDIS_URL"
        value = digitalocean_database_cluster.redis.private_uri
        type  = "SECRET"
      }
    }

    worker {
      name               = "clamav"
      instance_count     = 1
      instance_size_slug = "apps-d-1vcpu-2gb"
      image {
        registry_type = "DOCKER_HUB"
        registry      = "clamav"
        repository    = "clamav"
        tag           = "1.4"
      }
    }

    # Migrations run before each deploy with the owner credentials (the app role has no DDL rights).
    job {
      name               = "migrate"
      kind               = "PRE_DEPLOY"
      instance_size_slug = "apps-s-1vcpu-0.5gb"
      run_command        = "node packages/db/dist/migrate-cli.js"
      image {
        registry_type = "GHCR"
        registry      = split("/", var.github_repo)[0]
        repository    = "${split("/", lower(var.github_repo))[1]}-api"
        tag           = var.image_tag
      }
      env {
        key   = "DATABASE_ADMIN_URL"
        value = digitalocean_database_cluster.pg.private_uri
        type  = "SECRET"
      }
      env {
        key   = "DATABASE_APP_PASSWORD"
        value = var.secrets["DATABASE_APP_PASSWORD"]
        type  = "SECRET"
      }
    }

    alert { rule = "DEPLOYMENT_FAILED" }
    alert { rule = "DOMAIN_FAILED" }
  }
}

# Web tier on Vercel (BR-12): two projects with separate domains and cookies.
resource "vercel_project" "site" {
  name           = "${local.name}-site"
  framework      = "nextjs"
  root_directory = "apps/site"
  git_repository {
    type = "github"
    repo = var.github_repo
  }
  serverless_function_region = "fra1"
}

resource "vercel_project" "console" {
  name           = "${local.name}-console"
  framework      = "nextjs"
  root_directory = "apps/console"
  git_repository {
    type = "github"
    repo = var.github_repo
  }
  serverless_function_region = "fra1"
}

resource "vercel_project_domain" "site" {
  project_id = vercel_project.site.id
  domain     = var.site_domain
}

resource "vercel_project_domain" "console" {
  project_id = vercel_project.console.id
  domain     = var.console_domain
}

resource "vercel_project_environment_variable" "site_api" {
  project_id = vercel_project.site.id
  key        = "API_URL"
  value      = "https://${var.api_domain}"
  target     = ["production", "preview"]
}

resource "vercel_project_environment_variable" "console_api" {
  project_id = vercel_project.console.id
  key        = "API_URL"
  value      = "https://${var.api_domain}"
  target     = ["production", "preview"]
}
