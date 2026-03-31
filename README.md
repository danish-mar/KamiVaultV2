# KamiVault v2: AI-Powered Smart Document Management

KamiVault v2 is a next-generation document management system that leverages the power of **Google Gemini 1.5 Flash** to provide automated, structured data extraction from any PDF or image. It combines a secure digital vault with a dynamic database schema to streamline document processing and data indexing.

## 🚀 Key Features

- **Smart Extraction (Gemini 1.5 Flash)**: Automatically converts unstructured documents (Invoices, IDs, Forms) into structured JSON data with high accuracy.
- **Dynamic Schema Generation**: Create "Scrolls" (projects) and define their structure by simply uploading an "Anchor" document. The system automatically creates a matching PostgreSQL table for optimized data storage.
- **Secure Document Vault**: Integrated with MinIO/S3 storage for reliable, redundant document archiving.
- **Multi-Factor Authentication (2FA)**: Support for TOTP-based 2FA (Google Authenticator, Authy) to ensure top-tier account security.
- **Collaborative Sharing**: Securely share "Scrolls" with other users via email, with full control over access permissions.
- **Integrity Tracking**: Confidence scores and flagging for review system to ensure the highest data quality.

## 🛠 Technology Stack

### Backend & Core
- **Runtime**: Node.js v18+
- **Language**: TypeScript
- **Framework**: Express.js
- **Views**: EJS with Layouts

### AI & Data Extraction (Pipeline)
- **Runtime**: Python 3.9+
- **Framework**: FastAPI
- **Model**: Google Gemini 1.5 Flash

### Databases & Storage
- **NoSQL**: MongoDB (User metadata, Scroll configuration, Document status)
- **SQL**: PostgreSQL (Structured extracted data)
- **Storage**: MinIO / AWS S3 (Original document binary storage)

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Security**: JWT & Cookie-based Authentication

## 📂 Project Structure

```text
├── src/
│   ├── app.ts            # Express application setup
│   ├── server.ts         # Entry point for the Node.js server
│   ├── config/           # Database and S3 configurations
│   ├── controllers/      # Route controllers (Auth, User, Scrolls)
│   ├── middleware/       # JWT auth and 2FA middlewares
│   ├── models/           # Mongoose (MongoDB) models
│   ├── routes/           # API and View routing
│   ├── services/         # External services (Pipeline, S3)
│   └── types/            # Custom TypeScript declarations
├── views/                # EJS templates for the UI
├── main.py               # Python AI Pipeline (FastAPI)
└── docker-compose.yml     # Infrastructure orchestration
```

## ⚙️ Setup & Installation

### Prerequisites
- Docker & Docker Compose installed
- Google Gemini API Key

### Environment Configuration
Create a `.env` file in the root directory:
```env
# Server
PORT=3000
JWT_SECRET=your_jwt_secret

# MongoDB
MONGO_URI=mongodb://localhost:27017/kamivault

# PostgreSQL
DATABASE_URL=postgres://postgres:postgres_password@localhost:5432/kamivault_pg

# S3 / MinIO
S3_ENDPOINT=localhost
S3_PORT=9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=documents

# AI Pipeline
GEMINI_API_KEY=your_gemini_api_key
PIPELINE_URL=http://localhost:8001
```

### Running with Docker
```bash
docker-compose up -d
```

## 📜 Usage
1.  **Register & Login**: Create an account and set up 2FA for extra security.
2.  **Create a Scroll**: A logical container for a specific document type.
3.  **Set Anchor**: Upload a representative document to define the data structure.
4.  **Batch Upload**: Upload your bulk documents to extract data automatically.
5.  **Review & Export**: Verify confidence scores and view extracted data in the Vault.
