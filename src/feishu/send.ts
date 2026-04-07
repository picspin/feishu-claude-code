const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

export interface DownloadedResource {
  content: Buffer;
  fileName?: string;
  mimeType?: string;
}

let tenantToken = '';
let tenantTokenExpiresAt = 0;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

async function getTenantToken(): Promise<string> {
  if (tenantToken && Date.now() < tenantTokenExpiresAt) {
    return tenantToken;
  }

  const response = await fetch(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: requiredEnv('FEISHU_APP_ID'),
      app_secret: requiredEnv('FEISHU_APP_SECRET'),
    }),
  });
  const data = await response.json() as { code: number; msg: string; tenant_access_token?: string; expire?: number };
  if (!response.ok || data.code !== 0 || !data.tenant_access_token || !data.expire) {
    throw new Error(`Feishu auth failed: ${data.msg || response.statusText}`);
  }
  tenantToken = data.tenant_access_token;
  tenantTokenExpiresAt = Date.now() + Math.max(data.expire - 60, 60) * 1000;
  return tenantToken;
}

async function feishuRequest(path: string, init?: RequestInit): Promise<Response> {
  const token = await getTenantToken();
  return fetch(`${FEISHU_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

export async function sendTextMessage(receiveIdType: 'chat_id' | 'open_id' | 'user_id', receiveId: string, text: string): Promise<void> {
  const response = await feishuRequest(`/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await response.json() as { code: number; msg: string };
  if (!response.ok || data.code !== 0) {
    throw new Error(`Feishu send failed: ${data.msg || response.statusText}`);
  }
}

export async function downloadMessageResource(messageId: string, fileKey: string, type: 'file' | 'image'): Promise<DownloadedResource> {
  const query = new URLSearchParams({ file_key: fileKey, type }).toString();
  const response = await feishuRequest(`/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?${query}`);
  if (!response.ok) {
    throw new Error(`Feishu download failed: ${response.statusText}`);
  }
  const contentDisposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition);
  const fileName = fileNameMatch?.[1] ? decodeURIComponent(fileNameMatch[1]) : fileNameMatch?.[2];
  return {
    content: Buffer.from(await response.arrayBuffer()),
    fileName,
    mimeType: response.headers.get('content-type') || undefined,
  };
}
