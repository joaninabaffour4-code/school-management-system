# Cloud Deployment Guide: Render, Vercel & AWS

This project is configured for cloud deployment across **Render**, **Vercel**, and **Amazon Web Services (AWS)**.

---

## 🚀 Option 1: Deploy on Render (Recommended for Full-Stack)

Render provides persistent containers, persistent disk storage, long-running Node.js processes, and background cron scheduling (ideal for automated database backups).

### 1-Click Blueprint Deployment
1. Go to [Render Dashboard](https://dashboard.render.com/) and log in with your GitHub account (**`joaninabaffour4-code`**).
2. Click **New +** at the top right and select **Blueprint**.
3. Connect your repository: **`joaninabaffour4-code/school-management-system`**.
4. Render will automatically detect [`render.yaml`](../render.yaml) and configure:
   - **Environment**: Node.js
   - **Build Command**: `npm install && npm run seed`
   - **Start Command**: `npm start`
   - **Health Check**: `/health`
   - **Environment Variables**: Automatically populated from `render.yaml`.
5. Click **Apply**.
6. Render will build, seed the academic database, and provide a live public HTTPS URL (e.g. `https://school-management-system-xxxx.onrender.com`).

---

## ⚡ Option 2: Deploy on Vercel (Serverless Global CDN)

Vercel provides edge serverless function hosting and instant worldwide routing.

### 1-Click Git Import Deployment
1. Go to [Vercel Dashboard](https://vercel.com/) and log in with GitHub (**`joaninabaffour4-code`**).
2. Click **Add New...** -> **Project**.
3. Import **`joaninabaffour4-code/school-management-system`**.
4. Vercel will automatically detect [`vercel.json`](../vercel.json) and route all requests through the serverless entrypoint [`api/index.js`](../api/index.js).
5. In **Environment Variables**, add:
   - `JWT_SECRET`: (Any secure 64-character random string)
   - `PEPPER_KEY`: `BajonasClosetPepperKey2026`
   - `AES_ENCRYPTION_KEY`: `6b8d9c2a1e4f5a3b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b`
   - `NODE_ENV`: `production`
6. Click **Deploy**.
7. Vercel will launch your application live at `https://school-management-system-xxxx.vercel.app`.

---

## ☁️ Option 3: AWS Deployment Readiness (Lecturer Defense)

The system remains **100% AWS deployment ready**. Even when hosted on Render or Vercel, the application actively performs **automated database backups to Amazon S3**.

### AWS Deployment Assets Included in Repository:
1. **Docker Containerization**: [`Dockerfile`](../Dockerfile) ready for **AWS App Runner** or **Amazon ECS**.
2. **EC2 Production Deployment**: [`aws/deploy_ec2.sh`](../aws/deploy_ec2.sh) for **Amazon EC2 Ubuntu 24.04 LTS** + Nginx + Systemd.
3. **AWS S3 Backup Provisioning**: [`aws/setup_aws_s3.sh`](../aws/setup_aws_s3.sh) to configure Block Public Access, SSE-AES256 encryption, and 30-day lifecycle retention.
4. **Least-Privilege IAM Policy**: [`aws/iam_policy_s3_backup.json`](../aws/iam_policy_s3_backup.json) restricting IAM user permissions exclusively to the backup bucket ARN.
5. **Node AWS Deployment Runner**: [`aws/deploy_aws.js`](../aws/deploy_aws.js) (`npm run deploy:aws`) for cross-platform cloud testing.
