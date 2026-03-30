import { CreateBucketCommand, HeadBucketCommand, S3ServiceException } from '@aws-sdk/client-s3';
import s3Client from './s3Client';

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'kamivault-storage';

export const initS3 = async () => {
  try {
    // Check if bucket exists
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`S3 Bucket "${BUCKET_NAME}" already exists.`);
  } catch (error) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
      // Create bucket if it doesn't exist
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
        console.log(`S3 Bucket "${BUCKET_NAME}" created successfully.`);
      } catch (createError) {
        console.error(`Error creating S3 bucket: ${createError}`);
      }
    } else {
      console.error(`Error checking S3 bucket: ${error}`);
    }
  }
};
