# Push notifications and deep links

- Device tokens: `POST /v1/portal/devices` (per device, FR-COM-7), removed by `POST /v1/portal/devices/unregister` or
  when the account signs out everywhere.
- Push recipients are the confirmed accounts linked to the patient. Push payloads carry no PHI beyond the rendered
  template text.
- Every message may carry `data.path`; FCM delivers it as `message.data.path`. Apps navigate to that path:

| Event | `data.path` |
|---|---|
| booking_confirmed, rescheduled, cancelled_*, no_show_notice, checkin_ticket, turn_approaching | `/appointments/<appointmentId>` |
| review_request | `/review/<appointmentId>` |
| prescription_shared | `/rx` |
| report_ready | `/reports` |
| payment_received | `/invoices` |

- Online payments from the app return to `APP_RETURN_URL` (default `healthflow://book/result?ref=…&appointment=…`);
  the website keeps `PUBLIC_SITE_URL/ar/book/result`. Universal links on the site domain still work for both.
