#!/bin/bash

# Pinball Stats Setup Script for Mac
echo "🎮 Pinball Stats Tracker - Setup Script"
echo "========================================"
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "📦 Homebrew not found. Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for Apple Silicon Macs
    if [[ $(uname -m) == "arm64" ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
else
    echo "✅ Homebrew is already installed"
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js via Homebrew..."
    brew install node
else
    echo "✅ Node.js is already installed (version: $(node -v))"
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found even after Node.js installation. Please restart your terminal."
    exit 1
else
    echo "✅ npm is installed (version: $(npm -v))"
fi

echo ""
echo "📁 Setting up the Pinball Stats project..."
echo ""

# Install project dependencies
echo "📦 Installing project dependencies..."
npm install

echo ""
echo "🔧 Setting up environment variables..."

# Check if .env.local exists
if [ ! -f .env.local ]; then
    if [ -f .env.local.example ]; then
        cp .env.local.example .env.local
        echo "✅ Created .env.local from example"
        echo ""
        echo "⚠️  IMPORTANT: You need to add your Supabase credentials to .env.local"
        echo "   1. Go to https://supabase.com and create a free account"
        echo "   2. Create a new project"
        echo "   3. Go to Settings > API"
        echo "   4. Copy your project URL and anon key"
        echo "   5. Edit .env.local and add your credentials"
        echo ""
    fi
else
    echo "✅ .env.local already exists"
fi

echo ""
echo "📂 Creating directories for game photos..."
mkdir -p public/games
echo "✅ Created public/games directory for your 400 game photos"

echo ""
echo "========================================="
echo "✅ Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Add your Supabase credentials to .env.local"
echo "2. Add your game photos to public/games/"
echo "3. Run: npm run dev"
echo "4. Open http://localhost:3000"
echo ""
echo "To start the development server now (without Supabase), run:"
echo "  npm run dev"
echo ""
