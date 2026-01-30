#!/bin/bash

# SplicR Setup Script
# This script sets up both frontend and backend for development

set -e

echo "🧬 Setting up SplicR..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check prerequisites
echo "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.11+ first."
    exit 1
fi

echo "${GREEN}✓ Prerequisites checked${NC}"
echo ""

# Setup Frontend
echo "${BLUE}Setting up frontend...${NC}"
cd frontend

if [ ! -f ".env.local" ]; then
    echo "Creating .env.local..."
    echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
fi

echo "Installing frontend dependencies..."
npm install

echo "${GREEN}✓ Frontend setup complete${NC}"
echo ""

# Setup Backend
echo "${BLUE}Setting up backend...${NC}"
cd ../backend

if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "Activating virtual environment..."
source venv/bin/activate

echo "Installing backend dependencies..."
pip install -r requirements.txt

echo "${GREEN}✓ Backend setup complete${NC}"
echo ""

# Success message
echo "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "To start the development servers:"
echo ""
echo "Frontend (in terminal 1):"
echo "  cd frontend"
echo "  npm run dev"
echo ""
echo "Backend (in terminal 2):"
echo "  cd backend"
echo "  source venv/bin/activate"
echo "  uvicorn main:app --reload"
echo ""
echo "Then visit http://localhost:3000"
echo ""
