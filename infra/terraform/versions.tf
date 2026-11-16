terraform {
  required_version = ">= 1.6"
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean", version = "~> 2.50" }
    vercel       = { source = "vercel/vercel", version = "~> 3.0" }
  }
  # State in a private Spaces bucket (S3-compatible). Configure with -backend-config.
  backend "s3" {}
}

provider "digitalocean" {
  token             = var.do_token
  spaces_access_id  = var.spaces_access_id
  spaces_secret_key = var.spaces_secret_key
}

provider "vercel" {
  api_token = var.vercel_token
  team      = var.vercel_team
}
