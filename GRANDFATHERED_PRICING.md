# Grandfathered Pricing Implementation Guide

This document explains how to set up and use grandfathered pricing for past mentees and instructors when prices increase.

## Overview

The system supports grandfathered pricing through Stripe coupons and promotion codes. When a user is identified as "grandfathered," they automatically receive a discount on future purchases, allowing them to maintain their original pricing even after you raise prices for new customers.

## Features

✅ **Automatic Discount Application**: Grandfathered users automatically get discounts applied at checkout  
✅ **Customer-Entered Codes**: Customers can also enter promotion codes manually  
✅ **Flexible Configuration**: Configure via environment variables or code  
✅ **Full Tracking**: All discounts are tracked in the `orders` table for reporting

## Setup Instructions

### Step 1: Create Coupons in Stripe

1. Go to [Stripe Dashboard → Coupons](https://dashboard.stripe.com/coupons)
2. Click **"Create coupon"**
3. Configure your coupon:
   - **Name**: e.g., "Grandfathered 20% Off"
   - **Type**: Percentage off or Fixed amount
   - **Percent off**: e.g., 20 (for 20% discount)
   - **Duration**: `once` (for one-time payments)
   - **Redemption limits**: Optional (e.g., max 100 redemptions)
4. Click **"Create coupon"**
5. **Copy the Coupon ID** (e.g., `grandfathered_20_off`)

### Step 2: Create Promotion Codes (Optional but Recommended)

For better tracking and customer-specific codes:

1. In the coupon you just created, click **"Create promotion code"**
2. Set a **Code**: e.g., `GRANDFATHERED2024`
3. **Restrictions** (optional):
   - **Customer**: Restrict to specific customers
   - **First-time transaction**: Only for new customers
   - **Minimum amount**: Minimum purchase amount
   - **Expires at**: Set expiration date
4. Click **"Create promotion code"**

### Step 3: Configure Environment Variables

Add these to your `.env` file:

```env
# Grandfathered Pricing Configuration
# Option 1: Use a coupon ID (auto-applied to grandfathered users)
GRANDFATHERED_COUPON_ID=grandfathered_20_off

# Option 2: Use a promotion code (alternative to coupon ID)
# GRANDFATHERED_PROMOTION_CODE=GRANDFATHERED2024

# Date threshold: Users with paid orders before this date are grandfathered
# Format: ISO date string (YYYY-MM-DD)
GRANDFATHERED_BEFORE_DATE=2024-01-01
```

**Note**: Use either `GRANDFATHERED_COUPON_ID` OR `GRANDFATHERED_PROMOTION_CODE`, not both.

### Step 4: Run Database Migration

The schema has been updated to include discount fields. Run your migration:

```bash
cd packages/db
pnpm drizzle-kit push
# or
pnpm drizzle-kit migrate
```

## How It Works

### Automatic Grandfathered Detection

The system automatically checks if a user is grandfathered when they initiate checkout:

1. **Check User History**: Looks for paid orders before `GRANDFATHERED_BEFORE_DATE`
2. **Apply Discount**: If grandfathered, automatically applies the coupon/promotion code
3. **Track Discount**: Stores discount amount and code in the `orders` table

### Customer-Entered Promotion Codes

Customers can also enter promotion codes manually:

1. **Enable in Checkout**: The checkout automatically allows promotion codes if no auto-apply discount is set
2. **Customer Enters Code**: Customer types code (e.g., `GRANDFATHERED2024`) in Stripe Checkout
3. **Validation**: Stripe validates the code and applies discount
4. **Track**: Discount is tracked in the order

### Discount Tracking

All discounts are stored in the `orders` table:

- `originalAmount`: Price before discount
- `discountAmount`: Amount discounted
- `totalAmount`: Final amount charged (after discount)
- `discountCode`: Coupon ID or promotion code used

## Usage Examples

### Example 1: 20% Off for Grandfathered Users

**Scenario**: You want to give 20% off to users who purchased before January 1, 2024.

1. Create coupon in Stripe: `grandfathered_20_off` (20% off, duration: once)
2. Set environment variables:
   ```env
   GRANDFATHERED_COUPON_ID=grandfathered_20_off
   GRANDFATHERED_BEFORE_DATE=2024-01-01
   ```
3. When a grandfathered user checks out, they automatically get 20% off

### Example 2: Customer-Specific Promotion Codes

**Scenario**: You want to give specific codes to specific customers.

1. Create coupon: `grandfathered_25_off` (25% off)
2. Create promotion codes for each customer:
   - Customer A: `ALICE2024`
   - Customer B: `BOB2024`
3. Share codes with customers
4. Customers enter codes at checkout
5. System tracks which code was used

### Example 3: Fixed Amount Discount

**Scenario**: You want to give $50 off to grandfathered users.

1. Create coupon in Stripe:
   - Type: Fixed amount
   - Amount: $50.00
   - Duration: once
2. Set environment variable:
   ```env
   GRANDFATHERED_COUPON_ID=fixed_50_off
   GRANDFATHERED_BEFORE_DATE=2024-01-01
   ```

## Customizing Grandfathered Logic

You can customize the grandfathered detection logic by modifying `packages/db/src/lib/queries/discounts.ts`:

```typescript
// Example: Check if user has more than 3 paid orders
export async function isUserGrandfathered(
  userId: string,
  config?: GrandfatheredUserConfig
): Promise<boolean> {
  // Your custom logic here
  const paidOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "paid")
      )
    );
  
  return paidOrders.length >= 3;
}
```

## API Usage

### Checkout with Auto-Applied Discount

The checkout route automatically applies discounts for grandfathered users:

```typescript
// POST /api/checkout/stripe
{
  "packId": "pack-uuid"
}

// If user is grandfathered, discount is automatically applied
// No additional code needed!
```

### Checkout with Customer-Entered Code

```typescript
// POST /api/checkout/stripe
{
  "packId": "pack-uuid",
  "promotionCode": "GRANDFATHERED2024" // Optional
}
```

## Database Schema

The `orders` table now includes:

```sql
discount_amount NUMERIC(10, 2)      -- Amount discounted
discount_code TEXT                  -- Coupon ID or promotion code
original_amount NUMERIC(10, 2)     -- Price before discount
```

## Reporting

Query discounted orders:

```typescript
import { db, orders } from "@mentorships/db";
import { isNotNull } from "drizzle-orm";

// Get all orders with discounts
const discountedOrders = await db
  .select()
  .from(orders)
  .where(isNotNull(orders.discountAmount));
```

## PayPal Support

PayPal doesn't have built-in coupon support for one-time payments. When you implement PayPal checkout, you'll need to:

1. Calculate discount server-side before creating the PayPal order
2. Create the order with the discounted amount
3. Store discount information in the `orders` table

Example:

```typescript
// Calculate discount
const discountPercent = 0.20; // 20% off
const discountedAmount = originalAmount * (1 - discountPercent);

// Create PayPal order with discounted amount
const paypalOrder = await paypal.orders.create({
  purchase_units: [{
    amount: {
      value: discountedAmount.toString(),
      currency_code: "USD"
    }
  }]
});
```

## Troubleshooting

### Discount Not Applying

1. **Check Environment Variables**: Ensure `GRANDFATHERED_COUPON_ID` or `GRANDFATHERED_PROMOTION_CODE` is set
2. **Verify Coupon**: Check that the coupon exists in Stripe Dashboard
3. **Check Date**: Verify `GRANDFATHERED_BEFORE_DATE` is set correctly
4. **User Eligibility**: Check if user has paid orders before the cutoff date

### Promotion Code Not Working

1. **Code Active**: Ensure promotion code is active in Stripe
2. **Not Expired**: Check expiration date
3. **Redemption Limits**: Check if max redemptions reached
4. **Customer Restrictions**: Verify customer restrictions if set

## Best Practices

1. **Test First**: Always test with Stripe test mode before production
2. **Monitor Usage**: Track discount usage in Stripe Dashboard
3. **Set Expiration**: Set expiration dates on promotion codes to prevent abuse
4. **Limit Redemptions**: Set max redemptions for time-limited offers
5. **Document Codes**: Keep a list of active promotion codes and their purposes

## Support

For issues or questions:
- Check Stripe Dashboard for coupon/promotion code status
- Review webhook logs for discount application
- Check database `orders` table for discount tracking

