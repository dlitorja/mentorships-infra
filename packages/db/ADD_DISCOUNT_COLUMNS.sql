-- Migration: Add discount columns to orders table
-- Run this in your Supabase SQL Editor

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(10, 2);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount_code" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "original_amount" numeric(10, 2);

