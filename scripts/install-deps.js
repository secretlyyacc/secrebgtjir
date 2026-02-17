// scripts/install-deps.js
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

console.log('🔧 Installing system dependencies for Railway...');

try {
  // Check if we're on Railway
  const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || 
                    process.env.RAILWAY_GIT_COMMIT_SHA;

  if (isRailway) {
    console.log('🚇 Detected Railway environment');
    
    // Install Chromium dependencies
    console.log('📦 Installing Chromium dependencies...');
    
    // Minimal dependencies for Chromium
    const packages = [
      'ca-certificates',
      'fonts-liberation',
      'libappindicator3-1',
      'libasound2',
      'libatk-bridge2.0-0',
      'libatk1.0-0',
      'libc6',
      'libcairo2',
      'libcups2',
      'libdbus-1-3',
      'libexpat1',
      'libfontconfig1',
      'libgbm1',
      'libgcc1',
      'libglib2.0-0',
      'libgtk-3-0',
      'libnspr4',
      'libnss3',
      'libpango-1.0-0',
      'libpangocairo-1.0-0',
      'libstdc++6',
      'libx11-6',
      'libx11-xcb1',
      'libxcb1',
      'libxcomposite1',
      'libxcursor1',
      'libxdamage1',
      'libxext6',
      'libxfixes3',
      'libxi6',
      'libxrandr2',
      'libxrender1',
      'libxss1',
      'libxtst6',
      'lsb-release',
      'wget',
      'xdg-utils'
    ];

    console.log('Installing packages:', packages.join(', '));
    
    // Create a temporary script to install dependencies
    const installScript = `#!/bin/bash
      apt-get update
      apt-get install -y ${packages.join(' ')} --no-install-recommends
      rm -rf /var/lib/apt/lists/*
    `;
    
    fs.writeFileSync('/tmp/install-deps.sh', installScript);
    execSync('chmod +x /tmp/install-deps.sh && /tmp/install-deps.sh', { stdio: 'inherit' });
    
    console.log('✅ Dependencies installed successfully');
  } else {
    console.log('💻 Local environment detected, skipping system dependency installation');
  }
} catch (error) {
  console.error('❌ Error installing dependencies:', error.message);
  console.log('⚠️ Continuing anyway, hoping Chromium is already installed...');
}