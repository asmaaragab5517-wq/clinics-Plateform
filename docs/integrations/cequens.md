# Cequens SMS and WhatsApp

- Adapter: `apps/api/src/integrations/messaging.ts` (`CequensProvider`). Sender ID chosen by language
  (`CEQUENS_SENDER_AR`, `CEQUENS_SENDER_EN`; both must be approved by Cequens/NTRA).
- SMS body: rendered template; segments counted with GSM-7 160/153 and UCS-2 70/67 (`smsSegments`).
- WhatsApp: approved template name per event is stored in `message_templates.provider_template_id`.
- Delivery receipts: `POST /v1/webhooks/cequens`, HMAC-SHA256 of the raw body in `X-Cequens-Signature`.

**To confirm with Cequens:** request paths (`/sms/v1/messages`, `/whatsapp/v1/messages`), response field holding the
message id, DLR payload fields and signing method. Cost per segment is a constant (`SMS_COST_PER_SEGMENT`) until the
contract price is known.
