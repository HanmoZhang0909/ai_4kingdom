'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';
import ConversationList from '../components/ConversationList';
import { updateUserActiveThread } from '../utils/dynamodb';
import { getOpenAIResponse } from '../utils/openaiService';
import { OpenAI } from 'openai';

export interface ChatMessage {
  Message: string;
  Timestamp: string;
  UserId: string;
}

export interface ParsedMessage {
  userMessage: string;
  botReply: string;
}

interface UsageLimit {
    [key: string]: number;
    free: number;
    pro: number;
    ultimate: number;
}

const WEEKLY_LIMITS: UsageLimit = {
    free: 10,
    pro: 100,
    ultimate: Infinity
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

export default function Chat() {
  const { user, loading, error: authError } = useAuth();
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [weeklyUsage, setWeeklyUsage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const parseHistoryMessage = (messageStr: string) => {
    try {
      const parsed = JSON.parse(messageStr);
      const messages = [];
      
      if (parsed.userMessage?.trim()) {
        messages.push({ sender: 'user', text: parsed.userMessage.trim() });
      }
      if (parsed.botReply?.trim()) {
        messages.push({ sender: 'bot', text: parsed.botReply.trim() });
      }
      
      return messages;
    } catch (e) {
      console.error('[ERROR] 解析消息失败:', e);
      return [];
    }
  };

  const fetchHistory = async (threadId?: string) => {
    if (!user) return;
    
    setIsFetchingHistory(true);
    setError('');
    
    try {
      console.log('[DEBUG] 开始获取历史记录:', {
        userId: user.user_id,
        threadId
      });
      
      if (threadId) {
        // 如果有 threadId，直接从 OpenAI 获取消息
        const messages = await openai.beta.threads.messages.list(threadId);
        
        const formattedMessages = messages.data
          .map(message => ({
            sender: message.role === 'user' ? 'user' : 'bot',
            text: message.content
              .filter(content => content.type === 'text')
              .map(content => (content.type === 'text' ? content.text.value : ''))
              .join('\n')
          }))
          .reverse(); // 反转消息顺序，使最早的消息显示在顶部

        setMessages(formattedMessages);
      } else {
        // 如果没有 threadId，使用原有的 DynamoDB 查询逻辑
        const response = await fetch(
          `/api/chat?userId=${user.user_id}`,
          {
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (!response.ok) {
          throw new Error(`获取聊天历史失败: ${response.status}`);
        }
        
        const data = await response.json();
        const allMessages = data.flatMap((item: ChatMessage) => 
          parseHistoryMessage(item.Message)
        );
        
        setMessages(allMessages);
      }

      scrollToBottom();
      setError('');
    } catch (err) {
      console.error('[ERROR] 获取历史记录失败:', err);
      setError(err instanceof Error ? err.message : '加载失败');
      setMessages([]);
    } finally {
      setIsFetchingHistory(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user]);

  const sendMessage = async () => {
    if (!input.trim() || !user || isLoading) return;
    
    console.log('[DEBUG] 开始发送消息:', {
      userId: user.user_id,
      messageLength: input.length
    });
    
    setIsLoading(true);
    const currentInput = input;
    setInput('');
    setError('');

    try {
      // 如果是第一条消息，清空现有消息列表
      if (messages.length === 0) {
        setMessages([]);
      }
      
      // 添加用户消息到底部
      setMessages(prev => [...prev, { sender: 'user', text: currentInput }]);
      scrollToBottom();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.user_id,
          message: currentInput,
          threadId: currentThreadId
        })
      });

      if (!response.ok) {
        throw new Error(
          response.status === 504 
            ? '请求超时，请稍后重试'
            : `发送失败: ${response.status}`
        );
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      // 添加机器人回复到底部
      setMessages(prev => [...prev, { sender: 'bot', text: data.reply }]);
      setWeeklyUsage(prev => prev + 1);
      
      if (data.threadId && data.threadId !== currentThreadId) {
        setCurrentThreadId(data.threadId);
      }

    } catch (err) {
      console.error('[ERROR] 发送消息失败:', err);
      setInput(currentInput);
      setError(err instanceof Error ? err.message : '发送失败');
      
      // 移除最后一条消息（如果发送失败）
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  };

  const handleSelectThread = async (threadId: string) => {
    try {
      // 如果点击当前对话，不做任何操作
      if (threadId === currentThreadId) {
        return;
      }

      // 设置加载状态
      setIsLoading(true);
      // 清空当前消息和错误
      setMessages([]);
      setError('');
      
      // 更新当前线程ID
      setCurrentThreadId(String(threadId));
      
      // 获取新对话历史
      await fetchHistory(String(threadId));
      
      // 更新用户活动线程
      if (user?.user_id) {
        await updateUserActiveThread(user.user_id, threadId);
      }

    } catch (err) {
      console.error('[ERROR] 切换对话失败:', err);
      setError(err instanceof Error ? err.message : '切换对话失败');
      // 如果失败，恢复到之前的状态
      setCurrentThreadId(currentThreadId);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewThread = async () => {
    try {
      const response = await fetch('/api/threads/create', { method: 'POST' });
      const data = await response.json();
      if (data.threadId) {
        setCurrentThreadId(data.threadId);
        await updateUserActiveThread(user?.user_id!, data.threadId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建新对话失败');
    }
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div>认证错误: {error}</div>;
  if (!user) return (
    <div className={styles.loginPrompt}>
      <p>请先登录后使用</p>
      <button 
        className={styles.loginButton}
        onClick={() => window.open('https://ai4kingdom.com/login', '_blank')}
      >
        去登录
      </button>
    </div>
  );

  return (
    <div className={styles.container}>
      {user && (
        <div className={styles.conversationListContainer}>
          <ConversationList
            userId={user.user_id}
            currentThreadId={currentThreadId}
            onSelectThread={handleSelectThread}
            onCreateNewThread={handleCreateNewThread}
          />
        </div>
      )}
      <div className={styles.chatWindow}>
        {isFetchingHistory ? (
          <div className={styles.loading}>加载历史记录中...</div>
        ) : (
          <div className={styles.messages}>
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                <p>开始新的对话吧！</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={index}
                  className={`${styles.message} ${msg.sender === 'user' ? styles.user : styles.bot}`}
                >
                  {msg.sender === 'bot' && (
                    <img 
                      src="https://logos-world.net/wp-content/uploads/2023/02/ChatGPT-Logo.png"
                      alt="AI Avatar" 
                      className={styles.avatar}
                    />
                  )}
                  <div className={styles.messageContent}>
                    {msg.text}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.inputArea}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
            placeholder={isLoading ? "发送中..." : "输入消息..."}
            className={styles.inputField}
            disabled={isLoading || isFetchingHistory}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading || isFetchingHistory}
            className={styles.sendButton}
          >
            {isLoading ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}