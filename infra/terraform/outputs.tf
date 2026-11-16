output "api_default_ingress" { value = digitalocean_app.api.default_ingress }
output "pg_host" {
  value     = digitalocean_database_cluster.pg.private_host
  sensitive = true
}
output "reporting_replica_host" {
  value     = digitalocean_database_replica.reporting.private_host
  sensitive = true
}
output "bucket" { value = digitalocean_spaces_bucket.private.name }
