#!/usr/bin/env node

/**
 * Quick test script to verify Greptile API is working
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
  process.exit(1);
}

const GREPTILE_API_KEY = process.env.GREPTILE_API_KEY;

if (!GREPTILE_API_KEY) {
  console.error('❌ GREPTILE_API_KEY not found in environment variables');
  process.exit(1);
}

const query = `What is the structure of the session packs schema and how are they used?`;

const requestBody = {
  query: query,
  repositories: [
    {
      remote: "github",
      branch: "main",
      repository: "dlitorja/mentorships-infra"
    }
  ],
  sessionId: `test-query-${Date.now()}`,
  stream: false
};

console.log('🔍 Testing Greptile API...');
console.log('📝 Query:', query);
console.log('');

try {
  const response = await fetch('https://api.greptile.com/v2/query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GREPTILE_API_KEY}`,
      'Content-Type': 'application/json',
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
  
  console.log('✅ Greptile API is WORKING!');
  console.log('📊 Response received:', data.message ? 'Message present' : 'No message');
  console.log('📁 Sources found:', data.sources?.length || 0);
  console.log('');
  console.log('First 500 chars of response:');
  console.log(data.message?.substring(0, 500) || 'No message in response');
  console.log('');
  console.log('✅ Greptile is ready for queries!');
  process.exit(0);
  
} catch (error) {
  console.error('❌ Error querying Greptile API:', error.message);
  process.exit(1);
}

