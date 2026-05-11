# Environment Setup Verification

Since you've added your Clerk and Supabase keys to `.env.local`, let's verify everything is working correctly!

## Quick Verification Steps

### 1. Check Environment Variables

Visit the test page to verify all environment variables are loaded:

```bash
# Start the dev server
cd apps/web
pnpm dev

# Then visit:
http://localhost:3000/test
```

This page will show you:
- ✅ Which environment variables are set
- ✅ Clerk authentication status
- ✅ Database user sync status

### 2. Test API Endpoint

Check the API test endpoint:

```
http://localhost:3000/api/test
```

This returns a JSON response showing:
- Environment variable status
- Clerk configuration
- Supabase configuration
- Database configuration
- Current auth status

### 3. Test Authentication Flow

1. **Visit the home page:**
   ```
   http://localhost:3000
   ```

2. **Click "Sign Up"** to create a test account

3. **After signing up**, you should:
   - Be redirected to `/dashboard`
   - See your user information
   - User should be automatically synced to Supabase

4. **Check the test page again:**
   ```
   http://localhost:3000/test
   ```
   - Should show "✅ User synced to Supabase"
   - Should display your user data from the database

### 4. Verify Database Sync

After signing in, check Supabase to verify the user was created:

1. Go to your Supabase Dashboard
2. Navigate to Table Editor
3. Check the `users` table
4. You should see your new user record with:
   - Clerk user ID as the primary key
   - Your email address
   - Default role: "student"

## Expected Results

### ✅ All Good If:
- Test page shows all environment variables as "✅ Set"
- You can sign up/sign in successfully
- Dashboard loads after authentication
- Test page shows "✅ User synced to Supabase"
- User appears in Supabase `users` table

### ❌ Issues to Check:

**"Missing publishableKey" error:**
- Make sure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is in `.env.local`
- Restart the dev server after adding env vars

**"Database connection error":**
- Verify `DATABASE_URL` is correct
- Check Supabase project is active
- Ensure database migrations are applied

**"User not syncing":**
- Check browser console for errors
- Verify `DATABASE_URL` is accessible
- Try calling `/api/auth/sync` manually

## Next Steps After Verification

Once everything is verified:

1. ✅ **Customize Clerk UI** - Go to Clerk Dashboard → Appearance
2. ✅ **Add Social Logins** - Enable Google, GitHub, etc. in Clerk
3. ✅ **Set User Roles** - Configure roles in Clerk metadata
4. ✅ **Start Building Features** - Begin implementing mentorship features!

## Need Help?

- Check `CLERK_SETUP.md` for detailed Clerk setup
- Check `README.md` for general app documentation
- Review error messages in browser console and terminal

