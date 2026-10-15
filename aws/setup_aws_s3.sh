#!/usr/bin/env bash
# AWS S3 Automated Backup Bucket Setup Script
# Enforces Least Privilege, Block Public Access, AES256 Encryption, and 30-day Lifecycle

set -euo pipefail

BUCKET_NAME=${1:-"school-management-backups-2026"}
REGION=${2:-"us-east-1"}

echo "=== Setting up Protected AWS S3 Backup Bucket: $BUCKET_NAME in $REGION ==="

# 1. Create S3 Bucket
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION"
else
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

# 2. Block Public Access Completely
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# 3. Enable Default Server-Side Encryption (AES256)
aws s3api put-bucket-encryption \
  --bucket "$BUCKET_NAME" \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'

# 4. Enable Bucket Versioning
aws s3api put-bucket-versioning \
  --bucket "$BUCKET_NAME" \
  --versioning-configuration Status=Enabled

# 5. Apply 30-Day Lifecycle Retention Rule
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_NAME" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "PruneBackupsAfter30Days",
        "Status": "Enabled",
        "Filter": { "Prefix": "database-backups/" },
        "Expiration": { "Days": 30 },
        "NoncurrentVersionExpiration": { "NoncurrentDays": 14 }
      }
    ]
  }'

echo "=== Protected AWS S3 Backup Bucket is Ready and Hardened! ==="
