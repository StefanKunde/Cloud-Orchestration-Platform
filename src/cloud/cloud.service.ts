import axios, { AxiosInstance } from 'axios';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CloudProviderService {
  private http: AxiosInstance = axios.create({
    baseURL: 'https://api.example-cloud.com/v1',
    headers: { Authorization: `Bearer ${process.env.CLOUD_API_KEY}` },
    timeout: 20000,
  });

  async createInstance(payload: any) {
    const { data } = await this.http.post('/instances', payload);
    return data.instance;
  }
  async getInstance(id: string) {
    const { data } = await this.http.get(`/instances/${id}`);
    return data.instance;
  }
  async deleteInstance(id: string) {
    await this.http.delete(`/instances/${id}`);
  }
  async listIPv4(id: string) {
    const { data } = await this.http.get(`/instances/${id}/ipv4`);
    return data.ipv4s;
  }
}
