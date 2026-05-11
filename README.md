# GOP Donor Dashboard

Ohio Republican donor prospecting tool built with Next.js + Supabase.

## Deploy to Vercel (15 minutes)

### Step 1 — Run the Supabase schema
1. Go to https://supabase.com/dashboard/project/grevzwujtthmopxkjyhn/sql
2. Open `supabase-schema.sql` from this folder
3. Paste the contents into the SQL editor and click Run

### Step 2 — Push to GitHub
1. Create a new GitHub repo at https://github.com/new (name it `donor-dashboard`, Private)
2. Run these commands from this folder:
```
git init
git add .
git commit -m "Initial donor dashboard"
git remote add origin https://github.com/YOUR_USERNAME/donor-dashboard.git
git push -u origin main
```

### Step 3 — Deploy on Vercel
1. Go to https://vercel.com/new
2. Click "Import Git Repository" and select your donor-dashboard repo
3. Under "Environment Variables", add:
   - NEXT_PUBLIC_SUPABASE_URL = https://grevzwujtthmopxkjyhn.supabase.co
   - NEXT_PUBLIC_SUPABASE_ANON_KEY = (your anon key)
4. Click Deploy

### Step 4 — Load your data
1. Open the live URL
2. Drop your CAC_CON_YYYY.CSV files onto the upload zone
3. Set scoring weights + geography + office target
4. Click Rescore donors
5. Click Save to DB

## Refreshing data
Upload new CSVs → Rescore → Save to DB

## Local development
npm install && npm run dev
