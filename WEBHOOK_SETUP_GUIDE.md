# Paystack Webhook Setup Guide

## ✅ Issues Fixed

### 1. **Added Webhook Signature Verification (CRITICAL SECURITY FIX)**
Your webhook now verifies the `x-paystack-signature` header using HMAC SHA512 to ensure webhooks are genuinely from Paystack. This prevents spoofing attacks.

**What was added:**
```javascript
function verifyPaystackSignature(rawBody, signature, secret) {
  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  return hash === signature;
}
```

### 2. **Added Event Type Filtering**
The webhook now only processes `charge.success` events and ignores other event types (like `charge.failed`, `transfer.success`, etc.).

### 3. **Added Comprehensive Diagnostic Logging**
Added detailed console logs to help diagnose webhook processing issues:
- Event type and reference received
- Order lookup results
- Processing status at each step
- Detailed error messages when orders aren't found

## 🚀 How to Set Up Webhooks for Production

### Step 1: Deploy Your Application
Your app needs to be publicly accessible for Paystack to send webhooks. Options:

**A. Deploy on Replit** (Recommended)
1. Click the "Deploy" button in Replit
2. Your app will get a public URL like `https://your-app.replit.app`

**B. Use ngrok for Local Testing**
```bash
# Install ngrok
npm install -g ngrok

# Start ngrok tunnel
ngrok http 5000

# You'll get a URL like: https://abc123.ngrok.io
```

### Step 2: Configure Webhook URL in Paystack Dashboard

1. Go to [Paystack Dashboard](https://dashboard.paystack.com)
2. Navigate to **Settings** → **Webhooks**
3. Add your webhook URL:
   - Production: `https://your-app.replit.app/api/paystack-webhook`
   - Testing: `https://abc123.ngrok.io/api/paystack-webhook`
4. Click **Save**

### Step 3: Test the Webhook

**Test with Paystack Sandbox:**
```bash
# Initiate a test M-PESA payment
curl -X POST http://localhost:5000/api/start-mpesa-charge \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "test_client_123",
    "phone": "+254710000000",
    "amount": 10000,
    "credits": 100,
    "email": "test@example.com"
  }'
```

**Monitor the webhook logs:**
```bash
# In your server logs, you should see:
[Webhook] Received event: charge.success, reference: dc-1234567890-5678
[Webhook] Found order ID: 123, client: test_client_123, status: pending
```

## 🐛 Troubleshooting Common Issues

### Issue 1: Orders Stay Pending
**Possible Causes:**
1. ❌ **Webhook URL not configured** - Paystack doesn't know where to send webhooks
2. ❌ **URL not publicly accessible** - Running on localhost without ngrok
3. ❌ **Wrong event type** - Not a `charge.success` event
4. ❌ **No matching order** - Order wasn't created before payment

**Solutions:**
- Verify webhook URL is set in Paystack dashboard
- Deploy app or use ngrok for testing
- Check server logs for `[Webhook]` messages
- Ensure `start-mpesa-charge` creates order before calling Paystack

### Issue 2: "Invalid Signature" Error
**Cause:** The webhook signature doesn't match

**Solutions:**
- Verify `PAYSTACK_SECRET_KEY` environment variable is correct
- Make sure you're using the same key (test/live) as your payment environment
- Check that the raw request body isn't being modified before verification

### Issue 3: "Unknown Order Recorded"
**Cause:** Webhook received for a reference that doesn't exist in the database

**Solutions:**
- Check if the order was created successfully before payment
- Verify the reference format matches (should be `dc-{timestamp}-{random}`)
- Look at `payment_events` table for the raw webhook payload
- Possible timing issue - payment completed before order saved

### Issue 4: Webhook Not Receiving Any Calls
**Possible Causes:**
1. Webhook URL not configured in Paystack
2. App not deployed/publicly accessible
3. Firewall blocking incoming requests

**Solutions:**
```bash
# Test webhook endpoint manually
curl -X POST https://your-app.replit.app/api/paystack-webhook \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: test" \
  -d '{"event":"charge.success","data":{"reference":"test-123"}}'

# Should return: {"error":"invalid_signature"}
# This confirms the endpoint is reachable
```

## 📊 Monitoring Webhook Activity

### Check Database Tables

**1. Orders Table**
```sql
-- Check recent orders
SELECT id, client_id, status, webhook_processed, paystack_reference, created_at 
FROM orders 
ORDER BY created_at DESC 
LIMIT 10;

-- Check pending orders
SELECT * FROM orders 
WHERE status = 'pending' AND webhook_processed = false;
```

**2. Payment Events Table**
```sql
-- Check recent webhook events
SELECT * FROM payment_events 
ORDER BY created_at DESC 
LIMIT 10;
```

### Server Logs
Look for these log patterns:

✅ **Successful Processing:**
```
[Webhook] Received event: charge.success, reference: dc-1234567890-5678
[Webhook] Found order ID: 123, client: test_client_123, status: pending
```

❌ **Failed Processing:**
```
[Webhook] No order found for reference: dc-1234567890-5678
[Webhook] This usually means:
  1. The order wasn't created before the payment was initiated
  2. The reference doesn't match what's in the database
  3. There's a timing issue - payment completed before order was saved
```

## 🔐 Security Best Practices

1. ✅ **Signature Verification** - Now implemented
2. ✅ **Event Type Filtering** - Only process `charge.success`
3. ✅ **Idempotency** - Check `webhook_processed` flag to prevent duplicate processing
4. ✅ **Transaction Verification** - Verify with Paystack API before crediting
5. ⚠️ **IP Whitelisting** (Optional) - Restrict to Paystack IPs:
   - 52.31.139.75
   - 52.49.173.169
   - 52.214.14.220

## 📝 Webhook Event Flow

```
1. User initiates M-PESA payment
   └─> API creates order in database (status: pending)
   └─> API calls Paystack /charge endpoint
   
2. User completes payment on phone
   └─> Paystack processes payment
   └─> Paystack sends webhook to your server
   
3. Your webhook handler receives request
   ├─> Verify signature ✅
   ├─> Check event type (charge.success) ✅
   ├─> Find order by reference ✅
   ├─> Check if already processed ✅
   ├─> Verify transaction with Paystack API ✅
   ├─> Update order (status: success, webhook_processed: true) ✅
   ├─> Call add_credits RPC ✅
   └─> Log event to payment_events ✅
```

## 🧪 Testing Checklist

- [ ] Environment variables set (PAYSTACK_SECRET_KEY, SUPABASE_URL, etc.)
- [ ] Webhook URL configured in Paystack dashboard
- [ ] Webhook endpoint is publicly accessible
- [ ] Test payment with sandbox number: +254710000000
- [ ] Check server logs for `[Webhook]` messages
- [ ] Verify order status changes to "success"
- [ ] Verify `webhook_processed` flag is set to true
- [ ] Verify credits are added to customer account

## 📚 Additional Resources

- [Paystack Webhooks Documentation](https://paystack.com/docs/payments/webhooks/)
- [Paystack Test Numbers](https://paystack.com/docs/payments/test-payments/)
- [HMAC Signature Verification](https://paystack.com/docs/payments/webhooks/#verify-signature)
