# Meta WhatsApp Cloud API: test account setup

This guide prepares the Meta account. The app still uses `MESSAGING_PROVIDER=fake`;
creating a Meta app does not automatically connect it to Feeflow. SMS is deferred.
Meta dashboard labels and eligibility checks can vary by account.

1. Sign in at https://developers.facebook.com/ and register a developer account.
2. Open **My Apps → Create App** and select the WhatsApp/business messaging use
   case. If prompted, choose/create your business portfolio and add the WhatsApp
   product. You do not need to add your personal UPI ID to Meta.
3. Open **WhatsApp → API Setup** (sometimes labelled Getting Started). Use the
   Meta-provided test sender initially; leave your everyday WhatsApp number alone.
4. Add your own phone as an allowed test recipient and verify it using Meta's
   code. Use the dashboard's sample `hello_world` template request to test delivery.
   Send this yourself from Meta's dashboard; Feeflow does not send a real message yet.
5. Record the **Phone Number ID** and **WhatsApp Business Account ID**. They are
   different identifiers; neither is simply the sender's phone number.
6. Store the temporary access token securely in local environment settings. Do
   not commit it or paste it into chat. Temporary tokens expire. Production will
   require the appropriate business/system-user access token and least-privilege
   permissions, account approval, sender setup and billing as applicable.
7. For the integration step, prepare a publicly reachable HTTPS API callback and
   checkout URL. `localhost` cannot receive Meta callbacks and cannot be shared
   with customers. For local development a reputable HTTPS tunnel can expose a
   deliberately scoped test endpoint. Production needs stable hosted endpoints.
8. We will implement GET callback verification, POST signature checking with the
   Meta app secret, inbox deduplication and delivery-status handling before you
   subscribe the callback to WhatsApp `messages` events. The current app does NOT
   yet implement that Meta callback; do not enter an invented URL in Meta.
9. Create utility templates for fee requests and reminders in WhatsApp Manager,
   in English/Hindi as needed. Proposed copy: “A payment of ₹{{1}} is due to
   {{2}} on {{3}}. View your payment request: {{4}}”. Final category, wording,
   variables, URL buttons and language codes must satisfy Meta's approval rules.
   App reminder offsets are not recurring payment/debit authorisation.
10. Test approved templates with consenting test recipients. A console log or
    SUBMITTED result is not proof of delivery. Confirm callbacks before real use.

Official starting point:
https://developers.facebook.com/docs/whatsapp/cloud-api/get-started

## Details needed for the next integration

You may share account setup progress, Phone Number ID, WABA ID and approved
**template names/language codes**. Keep access tokens and the app secret private.
The adapter will need a token, Phone Number ID, pinned supported Graph API
version, app secret, callback verify token, and template mappings. These are
integration inputs, not active configuration switches in this release.

Once `hello_world` reaches your own phone, we can connect the adapter and run
end-to-end delivery tests. Continue using staff verification for direct UPI;
WhatsApp delivery status cannot confirm a bank payment.
