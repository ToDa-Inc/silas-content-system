#!/bin/bash

echo "🎬 Installing B-Roll Caption Editor..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Download from: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Installation complete!"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Start preview: npm run dev"
    echo "   2. Edit captions in src/Root.jsx"
    echo "   3. Export video: npm run build"
    echo ""
    echo "📖 Read QUICKSTART.md for detailed instructions"
else
    echo "❌ Installation failed. Please check your Node.js setup."
    exit 1
fi
