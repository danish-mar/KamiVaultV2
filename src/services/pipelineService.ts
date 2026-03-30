import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const PIPELINE_URL = process.env.PIPELINE_URL || 'http://localhost:8001';

export const processAnchor = async (filePath: string, filename: string): Promise<any> => {
  const form = new FormData();
  form.append('files', fs.createReadStream(filePath), filename);
  form.append('instructions', 'Extract all visible fields from this document. Return as a flat JSON. Use common field names like date, invoice_no, total_amount, etc.');

  try {
    const response = await axios.post(`${PIPELINE_URL}/process/batch`, form, {
      headers: {
        ...form.getHeaders(),
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Pipeline processAnchor error:', error.message);
    throw error;
  }
};

export const processBatchFiles = async (files: { path: string, originalname: string }[], instructions: string, exampleJson?: string): Promise<any> => {
  const form = new FormData();
  files.forEach((file) => {
    form.append('files', fs.createReadStream(file.path), file.originalname);
  });
  form.append('instructions', instructions);
  if (exampleJson) {
      form.append('example_json', exampleJson);
  }

  try {
    const response = await axios.post(`${PIPELINE_URL}/process/batch`, form, {
      headers: {
        ...form.getHeaders(),
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Pipeline processBatchFiles error:', error.message);
    throw error;
  }
};
