#!/bin/bash
# A fluid, automated installer for Nexus AI on Linux/Mac.

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN}          __  __     ${NC}"
echo -e "${CYAN}       _ / / / /___  _  ____  _______${NC}"
echo -e "${CYAN}      / /_/ / / __ \\| |/_/ / / / ___/${NC}"
echo -e "${CYAN}     / __  / / /_/ />  </ /_/ (__  ) ${NC}"
echo -e "${CYAN}    /_/ /_/_/\\____/_/|_|\\__,_/____/  ${NC}"
echo -e "${MAGENTA}        N E X U S   A I   v1.0       ${NC}"
echo -e "${CYAN}=========================================${NC}\n"

# 1. Check for Node.js
echo -n -e "${CYAN}[1/4] Checking for Node.js... ${NC}"
if command -v node >/dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC}"
    node -v
else
    echo -e "${RED}[FAILED]${NC}"
    echo -e "${YELLOW}Node.js is not installed. Please install Node.js (v18+) to proceed.${NC}"
    exit 1
fi

# 2. Check for Git
echo -n -e "${CYAN}[2/4] Checking for Git... ${NC}"
if command -v git >/dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC}"
else
    echo -e "${RED}[FAILED]${NC}"
    echo -e "${YELLOW}Git is not installed. Please install Git to proceed.${NC}"
    exit 1
fi

# 3. Clone Repository
REPO_URL="https://github.com/Vishnu852002/myownweb.git"
INSTALL_DIR="$HOME/nexus-ai"

echo -e "\n${CYAN}[3/4] Cloning Nexus AI into $INSTALL_DIR...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Directory already exists. Removing old installation...${NC}"
    rm -rf "$INSTALL_DIR"
fi
git clone "$REPO_URL" "$INSTALL_DIR"

# 4. Install Dependencies
cd "$INSTALL_DIR"
echo -e "\n${CYAN}[4/4] Installing dependencies (this may take a minute)...${NC}"
npm install --production

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}  Nexus AI has been installed successfully!${NC}"
echo -e "${GREEN}=========================================${NC}\n"
echo -e "${CYAN}To start the application, run:${NC}"
echo -e "  cd ~/nexus-ai"
echo -e "  npm start\n"
echo -e "${CYAN}To run as a native Desktop App (Power User):${NC}"
echo -e "  npm run start:app\n"
