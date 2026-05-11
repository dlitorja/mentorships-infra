#!/usr/bin/env node

/**
 * Query Greptile API about monorepo dependency management and Vercel build errors
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
const envPath = join(__dirname, '..', '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf-8');
  const envVars = {};
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      envVars[key.trim()] = value.trim();
    }
  });
  Object.assign(process.env, envVars);
} catch (error) {
  console.error('Could not load .env.local file:', error.message);
}

const GREPTILE_API_KEY = process.env.GREPTILE_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

if (!GREPTILE_API_KEY) {
  console.error('❌ GREPTILE_API_KEY not found in environment variables');
  console.error('Please set GREPTILE_API_KEY in apps/web/.env.local');
  process.exit(1);
}

const query = `We're experiencing recurring Next.js and Vercel build errors in our pnpm monorepo. The main issues are:

1. Missing module errors (inngest, embla-carousel-react, autoprefixer, postcss) - dependencies exist in root package.json but not in apps/web/package.json
2. Tailwind CSS v4 compatibility issues with PostCSS and @apply directives
3. Next.js 16 and React 19 breaking changes

The project structure:
- Root package.json: Contains most dependencies (hoisted by pnpm)
- apps/web/package.json: Contains minimal dependencies
- Vercel builds fail because it only sees apps/web/package.json

What is the best practice for managing dependencies in a pnpm monorepo with Next.js for Vercel deployments? Should we:
1. Explicitly declare all dependencies in apps/web/package.json?
2. Configure Vercel to understand the monorepo structure?
3. Use a different dependency management strategy?

Please provide specific recommendations with code examples for fixing these build errors.`;

const requestBody = {
  query: query,
  repositories: [
    {
      remote: "github",
      branch: "fix/missing-header-component",
      repository: "dlitorja/mentorships-infra"
    }
  ],
  sessionId: `build-errors-query-${Date.now()}`,
  stream: false
};

console.log('🔍 Querying Greptile API about build errors...');
console.log('📝 Query:', query);
console.log('');

try {
  const response = await fetch('https://api.greptile.com/v2/query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GREPTILE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(GITHUB_TOKEN && { 'X-GitHub-Token': GITHUB_TOKEN })
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ API Error:', response.status, response.statusText);
    console.error('Response:', errorText);
    process.exit(1);
  }

  const data = await response.json();
  
  console.log('✅ Greptile Response:');
  console.log('='.repeat(80));
  if (data.message) {
    console.log(data.message);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  console.log('='.repeat(80));
  
  if (data.sources && data.sources.length > 0) {
    console.log('\n📚 Sources:');
    data.sources.forEach((source, i) => {
      console.log(`${i + 1}. ${source.path || source.file || 'Unknown'}`);
    });
  }
  
} catch (error) {
  console.error('❌ Error querying Greptile API:', error.message);
  process.exit(1);
}

