# Hosting location is decision D1. Default: DigitalOcean Frankfurt for the pilot; every resource takes the region
# from one variable so the stack can be re-created in another region/provider (NFR-10).
variable "environment" { type = string } # staging | production
variable "region" {
  type    = string
  default = "fra1"
}
variable "do_token" {
  type      = string
  sensitive = true
}
variable "spaces_access_id" {
  type      = string
  sensitive = true
}
variable "spaces_secret_key" {
  type      = string
  sensitive = true
}
variable "vercel_token" {
  type      = string
  sensitive = true
}
variable "vercel_team" { type = string }
variable "github_repo" {
  type    = string
  default = "asmaaragab5517-wq/clinics-Plateform"
}
variable "image_tag" {
  type    = string
  default = "latest"
}
variable "api_domain" { type = string }
variable "site_domain" { type = string }
variable "console_domain" { type = string }
variable "db_size" {
  type    = string
  default = "db-s-2vcpu-4gb"
}
variable "db_nodes" {
  type    = number
  default = 2 # primary + standby for availability (NFR-1)
}
variable "api_instances" {
  type    = number
  default = 2
}
# Non-secret runtime settings; secrets are injected as encrypted App Platform env vars (see secrets map).
variable "secrets" {
  type      = map(string)
  sensitive = true
  description = "FIELD_ENCRYPTION_KEY, PATIENT_JWT_SECRET, OTP_PEPPER, DISPLAY_TOKEN_SECRET, SHARE_LINK_SECRET, HEALTHPAY_WEBHOOK_SECRET, CEQUENS_API_KEY, CEQUENS_WEBHOOK_SECRET, FCM_SERVICE_ACCOUNT_JSON, SMTP_URL, KEYCLOAK_ADMIN_CLIENT_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY, DATABASE_APP_PASSWORD"
}
variable "keycloak_issuer" { type = string }
