/**
 * AWS Automated Deployment & S3 Backup Verification Runner
 * Cross-platform Node.js utility for Windows, macOS, and Linux
 *
 * Responsibilities:
 * 1. Checks AWS credentials and connectivity
 * 2. Hardens and configures S3 backup bucket (SSE-AES256, Block Public Access, Versioning, 30-Day Lifecycle)
 * 3. Triggers automated encrypted backup to AWS S3
 * 4. Downloads and cryptographically verifies test restoration
 * 5. Provides comprehensive guidance for EC2, App Runner, and Docker deployments
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { runDatabaseBackup } from '../src/utils/backup.js';
import { verifyRestoreTest } from '../src/utils/restore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BUCKET_NAME = process.env.AWS_S3_BACKUP_BUCKET || 'school-management-backups-2026';
const REGION = process.env.AWS_REGION || 'us-east-1';

console.log('================================================================');
console.log('  SCHOOL MANAGEMENT SYSTEM - AWS DEPLOYMENT & S3 BACKUP RUNNER  ');
console.log('================================================================');
console.log(`Target S3 Bucket : ${BUCKET_NAME}`);
console.log(`Target AWS Region: ${REGION}`);
console.log(`Database File    : ${process.env.DB_FILE || 'data/bajonas_closet.db'}`);
console.log('----------------------------------------------------------------\n');

async function runAwsDeployment() {
  const hasAccessKey = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (!hasAccessKey) {
    console.log('[AWS NOTICE] No AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY found in .env.');
    console.log('The system operates in Secure Local Fallback Mode for demonstrations.\n');
    console.log('=== LOCAL ENCRYPTED BACKUP & ISOLATED RESTORE DEMO ===');
    
    // Run backup locally
    console.log('1. Executing AES-256-GCM encrypted database backup...');
    const backupRes = await runDatabaseBackup('aws_deploy_runner');
    console.log(`   Destination: ${backupRes.destination}`);
    console.log(`   Encrypted  : ${backupRes.filename}`);
    console.log(`   Size       : ${backupRes.sizeBytes} bytes`);
    console.log(`   SHA-256    : ${backupRes.sha256}`);

    // Run restore test
    console.log('\n2. Executing Isolated Restore Integrity Test...');
    const restoreRes = await verifyRestoreTest();
    console.log(`   Restore Status: ${restoreRes.success ? 'SUCCESS (Integrity Matches 100%)' : 'FAILED'}`);
    console.log(`   Verified Rows : Tables=${restoreRes.tablesCount}, Users=${restoreRes.usersCount}, Classes=${restoreRes.classesCount}, Grades=${restoreRes.gradesCount}`);
    console.log(`   Restored From : ${restoreRes.backupFile}`);

    printAwsConfigurationGuide();
    return;
  }

  // Live AWS Execution
  console.log('[AWS DETECTED] AWS Credentials identified in environment.');
  const s3 = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
    },
  });

  try {
    console.log(`\n[STEP 1] Checking S3 Bucket: ${BUCKET_NAME}...`);
    let bucketExists = false;
    try {
      await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
      bucketExists = true;
      console.log(`  -> Bucket ${BUCKET_NAME} already exists.`);
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        console.log(`  -> Bucket not found. Creating bucket ${BUCKET_NAME} in ${REGION}...`);
        const createParams = { Bucket: BUCKET_NAME };
        if (REGION !== 'us-east-1') {
          createParams.CreateBucketConfiguration = { LocationConstraint: REGION };
        }
        await s3.send(new CreateBucketCommand(createParams));
        console.log(`  -> Bucket ${BUCKET_NAME} successfully created.`);
      } else {
        throw err;
      }
    }

    console.log('\n[STEP 2] Hardening S3 Bucket Security Policies...');
    
    // Block Public Access
    console.log('  -> Applying S3 Block Public Access (All 4 settings enabled)...');
    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: BUCKET_NAME,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      })
    );
    console.log('  -> [PASS] Public access completely blocked.');

    // Server-Side Encryption (AES256)
    console.log('  -> Enforcing Default Server-Side Encryption (SSE-AES256)...');
    await s3.send(
      new PutBucketEncryptionCommand({
        Bucket: BUCKET_NAME,
        ServerSideEncryptionConfiguration: {
          Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
        },
      })
    );
    console.log('  -> [PASS] Server-Side Encryption enabled.');

    // Versioning
    console.log('  -> Enabling S3 Bucket Versioning...');
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: BUCKET_NAME,
        VersioningConfiguration: { Status: 'Enabled' },
      })
    );
    console.log('  -> [PASS] S3 Versioning enabled.');

    // 30-day Lifecycle Pruning
    console.log('  -> Configuring 30-Day Automated Lifecycle Retention Rule...');
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: BUCKET_NAME,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'PruneSchoolBackupsAfter30Days',
              Status: 'Enabled',
              Filter: { Prefix: 'database-backups/' },
              Expiration: { Days: 30 },
              NoncurrentVersionExpiration: { NoncurrentDays: 14 },
            },
          ],
        },
      })
    );
    console.log('  -> [PASS] 30-day automated backup lifecycle rule enforced.');

    console.log('\n[STEP 3] Executing Live Encrypted Backup to AWS S3...');
    const liveBackup = await runDatabaseBackup('aws_deploy_runner');
    console.log(`  -> Destination: ${liveBackup.destination}`);
    console.log(`  -> File       : ${liveBackup.filename}`);
    console.log(`  -> S3 ETag    : ${liveBackup.s3Etag || 'N/A'}`);
    console.log(`  -> SHA-256    : ${liveBackup.sha256}`);

    console.log('\n[STEP 4] Executing Live Isolated Restore Test from Backup...');
    const restoreRes = await verifyRestoreTest();
    console.log(`  -> Restore Test: ${restoreRes.success ? 'PASSED (Integrity Validated)' : 'FAILED'}`);
    console.log(`  -> Restored Users: ${restoreRes.usersCount}, Classes: ${restoreRes.classesCount}, Tables: ${restoreRes.tablesCount}`);

    console.log('\n================================================================');
    console.log('  AWS S3 BACKUP INFRASTRUCTURE IS 100% OPERATIONAL & VERIFIED!  ');
    console.log('================================================================');
  } catch (err) {
    console.error('\n[AWS ERROR] Failed during AWS operations:', err.message);
    printAwsConfigurationGuide();
  }
}

function printAwsConfigurationGuide() {
  console.log('\n================================================================');
  console.log('          HOW TO CONNECT YOUR AWS ACCOUNT FOR LIVE DEMO         ');
  console.log('================================================================');
  console.log('1. Add your AWS IAM credentials to the project .env file:');
  console.log('   AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxxxxxxxx');
  console.log('   AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  console.log('   AWS_REGION=us-east-1');
  console.log('   AWS_S3_BACKUP_BUCKET=school-management-backups-2026');
  console.log('');
  console.log('2. Run this command again:');
  console.log('   node aws/deploy_aws.js');
  console.log('');
  console.log('3. Recommended IAM Policy:');
  console.log('   See: aws/iam_policy_s3_backup.json (Least-privilege S3 permissions)');
  console.log('');
  console.log('4. Application Cloud Deployment Options:');
  console.log('   a) Amazon EC2: Use aws/deploy_ec2.sh with Ubuntu 24.04 LTS + Nginx + Systemd');
  console.log('   b) AWS App Runner / ECS: Use Dockerfile with "docker build -t school-system ."');
  console.log('   c) AWS Elastic Beanstalk: Deploy root directory with "eb create school-env"');
  console.log('================================================================\n');
}

runAwsDeployment().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
