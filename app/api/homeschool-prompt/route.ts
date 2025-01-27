import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 添加调试日志
console.log('[DEBUG] AWS 环境变量:', {
  region: process.env.AWS_REGION,
  hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
  hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
  availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
});

// 检查环境变量
const validateEnvVars = () => {
  const credentials = {
    accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY,
    secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY,
    region: process.env.NEXT_PUBLIC_AWS_REGION
  };

  console.log('[DEBUG] 验证环境变量:', {
    hasAccessKey: !!credentials.accessKeyId,
    hasSecretKey: !!credentials.secretAccessKey,
    region: credentials.region
  });

  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    console.error('[ERROR] AWS凭证检查失败:', {
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
    console.log('[DEBUG] 创建 DynamoDB 客户端:', {
      region: credentials.region,
      hasCredentials: !!(credentials.accessKeyId && credentials.secretAccessKey)
    });
    
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
const docClient = DynamoDBDocumentClient.from(client);

// 创建或更新用户的 Assistant
async function getOrCreateAssistant(userId: string, childInfo: any) {
  try {
    // 先检查数据库中是否存在 assistant
    const getCommand = new GetCommand({
      TableName: 'HomeschoolPrompts',
      Key: { UserId: String(userId) }
    });

    const existingData = await docClient.send(getCommand);
    
    // 构建 instructions
    const instructions = `你是一个家校助手，主要帮助家长和老师沟通。
      学生信息：
      姓名：${childInfo.childName}
      基本状况：${childInfo.basicInfo}
      最新变化：${childInfo.recentChanges}
      
      请基于以上信息，帮助优化家长与老师的沟通。`;

    if (existingData.Item?.assistantId) {
      console.log('[DEBUG] 找到现有 Assistant，准备更新:', existingData.Item.assistantId);
      
      // 更新现有 Assistant 的 instructions
      const updatedAssistant = await openai.beta.assistants.update(
        existingData.Item.assistantId,
        {
          name: `Homeschool Assistant for ${childInfo.childName}`,
          instructions: instructions
        }
      );

      console.log('[DEBUG] Assistant 更新成功:', updatedAssistant.id);
      return existingData.Item.assistantId;
    }

    // 如果不存在，创建新的 Assistant
    console.log('[DEBUG] 创建新的 Assistant');
    const assistant = await openai.beta.assistants.create({
      name: `Homeschool Assistant for ${childInfo.childName}`,
      instructions: instructions,
      model: "gpt-4-turbo-preview"
    });

    console.log('[DEBUG] 新 Assistant 创建成功:', assistant.id);
    return assistant.id;

  } catch (error) {
    console.error('[ERROR] Assistant 创建/更新失败:', error);
    throw error;
  }
}

// 获取用户的家校信息
export async function GET(request: Request) {
  try {
    console.log('[DEBUG] 开始获取家校信息');
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    console.log('[DEBUG] 请求参数:', { userId });

    if (!userId) {
      console.log('[DEBUG] 缺少 userId');
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    const command = new GetCommand({
      TableName: 'HomeschoolPrompts',
      Key: { UserId: userId }
    });

    console.log('[DEBUG] DynamoDB 命令:', {
      TableName: command.input.TableName,
      Key: command.input.Key
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 响应:', response);
    
    return NextResponse.json(response.Item || {
      childName: '',
      basicInfo: '',
      recentChanges: ''
    });
  } catch (error) {
    console.error('[ERROR] 获取数据失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      envCheck: {
        hasRegion: !!process.env.AWS_REGION,
        hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
        availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
      }
    });
    return NextResponse.json({ error: '获取数据失败' }, { status: 500 });
  }
}

// 保存用户的家校信息
export async function POST(request: Request) {
  try {
    console.log('[DEBUG] 开始保存家校信息');
    const body = await request.json();
    const { userId, childName, basicInfo, recentChanges } = body;

    console.log('[DEBUG] 请求数据:', {
      userId,
      hasChildName: !!childName,
      hasBasicInfo: !!basicInfo,
      hasRecentChanges: !!recentChanges
    });

    if (!userId) {
      console.log('[DEBUG] 缺少 userId');
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    // 获取或创建 Assistant
    const assistantId = await getOrCreateAssistant(userId, {
      childName,
      basicInfo,
      recentChanges
    });

    const command = new PutCommand({
      TableName: 'HomeschoolPrompts',
      Item: {
        UserId: String(userId),
        childName,
        basicInfo,
        recentChanges,
        assistantId,  // 保存 assistantId
        updatedAt: new Date().toISOString()
      }
    });

    console.log('[DEBUG] DynamoDB 命令:', {
      TableName: command.input.TableName,
      Item: {
        ...command.input.Item,
        assistantId
      }
    });

    await docClient.send(command);
    console.log('[DEBUG] 保存成功');

    return NextResponse.json({ 
      success: true,
      assistantId  // 返回 assistantId 给客户端
    });
  } catch (error) {
    console.error('[ERROR] 保存数据失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      envCheck: {
        hasRegion: !!process.env.AWS_REGION,
        hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
        availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
      }
    });
    return NextResponse.json({ error: '保存数据失败' }, { status: 500 });
  }
} 