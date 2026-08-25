@echo off
start "" wt -w new --title "Python FastAPI" -d "C:\xampp\htdocs\APIDichAnh\cv-service" cmd /k "python main.py" ; new-tab --title "Node.js Server" -d "C:\xampp\htdocs\APIDichAnh" cmd /k "npm run dev" ; new-tab --title "Cloudflare Tunnel" -d "C:\xampp\htdocs\APIDichAnh" cmd /k "cloudflared tunnel --url http://localhost:3000"
exit