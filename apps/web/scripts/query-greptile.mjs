#!/usr/bin/env node

/**
 * Query Greptile API about instructor display implementation
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

const query = `How is the implementation for displaying instructors in random order on the /instructors page, but having them in alphabetical order when navigating through them on the instructor profile pages? Explain the current implementation and any potential improvements.`;

const requestBody = {
  query: query,
  repositories: [
    {
      remote: "github",
      branch: "main",
      repository: "dlitorja/mentorships-infra"
    }
  ],
  sessionId: `instructor-query-${Date.now()}`,
  stream: false
};

console.log('🔍 Querying Greptile API...');
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
  console.log(JSON.stringify(data, null, 2));
  console.log('='.repeat(80));
  
} catch (error) {
  console.error('❌ Error querying Greptile API:', error.message);
  process.exit(1);
}

