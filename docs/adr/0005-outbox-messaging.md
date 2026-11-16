# ADR 0005: Outbox messaging with provider adapters

Messages are inserted into `messages` inside the business transaction (booking, payment, check-in) and dispatched by the
worker every 15 s, with three attempts and exponential backoff. A provider outage never rolls back a booking, every
message is deduplicated by a key (e.g. `reminder:24:<appointment>`), quiet hours (22:00–09:00) defer non-urgent messages,
and delivery receipts update status for the per-clinic cost dashboard. OTPs are dispatched immediately.
Cequens (SMS, WhatsApp), SMTP and FCM are adapters behind `ChannelProvider`; a fake adapter is used in dev/test.
