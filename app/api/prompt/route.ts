import { NextResponse } from 'next/server';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";

// 添加调试日志
console.log('[DEBUG] AWS 环境变量:', {
  region: process.env.NEXT_PUBLIC_AWS_REGION || process.env.NEXT_PUBLIC_REGION,
  hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
  hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
  availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
});

// 检查环境变量
const validateEnvVars = () => {
  const requiredVars = [
    'NEXT_PUBLIC_REGION'
  ];
  
  // 检查AWS凭证
  const credentials = {
    accessKeyId: process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
    secretAccessKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
    region: process.env.NEXT_PUBLIC_AWS_REGION || process.env.NEXT_PUBLIC_REGION
  };

  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    console.error('AWS凭证检查失败:', {
      available: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_')),
      hasAccessKey: !!credentials.accessKeyId,
      hasSecretKey: !!credentials.secretAccessKey
    });
    throw new Error('AWS credentials not found');
  }

  return credentials;
};

// 创建 DynamoDB 客户端
const createDynamoDBClient = () => {
  try {
    const credentials = validateEnvVars();
    
    return new DynamoDBClient({
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.accessKeyId!,
        secretAccessKey: credentials.secretAccessKey!
      }
    });
  } catch (error) {
    console.error('[ERROR] DynamoDB 客户端创建失败:', error);
    throw error;
  }
};

const client = createDynamoDBClient();

// 添加调试日志查看凭证是否正确加载
console.log('[DEBUG] AWS Config:', {
  region: process.env.NEXT_PUBLIC_REGION,
  hasAccessKey: !!process.env.NEXT_PUBLIC_AWS_ACCESS_KEY,
  hasSecretKey: !!process.env.NEXT_PUBLIC_AWS_SECRET_KEY,
  accessKeyFirstChar: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY?.charAt(0),
  secretKeyLength: process.env.NEXT_PUBLIC_AWS_SECRET_KEY?.length
});

const docClient = DynamoDBDocumentClient.from(client);

const VECTOR_STORE_ID = process.env.NEXT_PUBLIC_VECTOR_STORE_ID || 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3';

// 获取当前Prompt
export async function GET(request: Request) {
  try {
    console.log('[DEBUG] 开始获取 Prompt');
    const { searchParams } = new URL(request.url);
    const vectorStoreId = searchParams.get('vectorStoreId') || VECTOR_STORE_ID;
    
    const command = new GetCommand({
      TableName: "AIPrompts",
      Key: { id: vectorStoreId }
    });

    console.log('[DEBUG] DynamoDB 命令:', {
      TableName: command.input.TableName,
      Key: command.input.Key
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 响应:', response);
    
    if (!response.Item) {
      console.log('[DEBUG] 未找到 Prompt，返回默认值');
      return NextResponse.json({
        id: vectorStoreId,
        content: "You are an AI assistant...",
        lastUpdated: new Date().toISOString()
      });
    }

    return NextResponse.json(response.Item);
  } catch (error) {
    console.error('[ERROR] 获取Prompt失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    
    return NextResponse.json(
      { 
        error: '获取Prompt失败',
        details: error instanceof Error ? error.message : '未知错误',
        type: error instanceof Error ? error.name : typeof error,
        envCheck: {
          hasRegion: !!process.env.NEXT_PUBLIC_AWS_REGION || !!process.env.NEXT_PUBLIC_REGION,
          hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
          hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
          availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
        }
      },
      { status: 500 }
    );
  }
}

// 更新Prompt
export async function PUT(request: Request) {
  try {
    console.log('[DEBUG] 开始更新 Prompt');
    const { content, vectorStoreId = VECTOR_STORE_ID } = await request.json();
    
    const command = new PutCommand({
      TableName: "AIPrompts",
      Item: {
        id: vectorStoreId,
        content,
        lastUpdated: new Date().toISOString()
      }
    });

    console.log('[DEBUG] DynamoDB 更新命令:', {
      TableName: command.input.TableName,
      Item: command.input.Item
    });

    await docClient.send(command);
    console.log('[DEBUG] Prompt 更新成功');
    
    return NextResponse.json({ 
      message: 'Prompt更新成功' 
    });
  } catch (error) {
    console.error('[ERROR] 更新Prompt失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    
    return NextResponse.json(
      { 
        error: '更新Prompt失败',
        details: error instanceof Error ? error.message : '未知错误',
        type: error instanceof Error ? error.name : typeof error
      },
      { status: 500 }
    );
  }
} 