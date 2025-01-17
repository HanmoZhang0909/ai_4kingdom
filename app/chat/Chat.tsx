'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';
import ConversationList from '../components/ConversationList';
import { updateUserActiveThread } from '../utils/dynamodb';
import { getOpenAIResponse } from '../utils/openaiService';

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

export default function Chat() {
  const { user, loading, error: authError } = useAuth();
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [weeklyUsage, setWeeklyUsage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const parseHistoryMessage = (messageStr: string) => {
    try {
      const parsed = JSON.parse(messageStr);
      const messages = [];
      
      if (parsed.userMessage) {
        messages.push({ sender: 'user', text: parsed.userMessage });
      }
      if (parsed.botReply) {
        messages.push({ sender: 'bot', text: parsed.botReply });
      }
      
      return messages;
    } catch (e) {
      console.error('Failed to parse message:', e);
      return [];
    }
  };

  const fetchHistory = async (threadId?: string) => {
    if (!user) return;
    
    try {
      const response = await fetch(`/api/chat?userId=${user.user_id}${threadId ? `&threadId=${threadId}` : ''}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`获取聊天历史失败: ${response.status}`);
      }
      
      const data = await response.json();
      const allMessages = data.flatMap((item: ChatMessage) => 
        parseHistoryMessage(item.Message)
      );
      
      setMessages(allMessages);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  };

  useEffect(() => {
    async function fetchHistory() {
      if (!user) return;
      
      console.log('[DEBUG] 开始获取历史记录:', {
        userId: user.user_id,
        userType: user.subscription?.type
      });
      
      try {
        const response = await fetch(`/api/chat?userId=${user.user_id}`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log('[DEBUG] 历史记录响应状态:', {
          status: response.status,
          ok: response.ok
        });
        
        if (!response.ok) {
          throw new Error(`获取聊天历史失败: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[DEBUG] 获取到的历史记录:', {
          recordCount: data.length
        });
        
        const allMessages = data.flatMap((item: ChatMessage) => 
          parseHistoryMessage(item.Message)
        );
        console.log('[DEBUG] 解析后的消息数量:', {
          messageCount: allMessages.length
        });
        
        setMessages(allMessages);
        scrollToBottom();
      } catch (err) {
        console.error('[ERROR] 获取历史记录失败:', err);
        setError(err instanceof Error ? err.message : '加载失败');
      }
    }

    if (user) {
      fetchHistory();
    }
  }, [user]);

  const sendMessage = async () => {
    if (!input.trim() || !user) return;
    
    console.log('[DEBUG] 开始发送消息:', {
      userId: user.user_id,
      messageLength: input.length,
      subscription: user.subscription?.type
    });
    
    setIsLoading(true);
    const currentInput = input;
    setInput('');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await getOpenAIResponse(currentInput);
      clearTimeout(timeoutId);

      if (!response.choices?.[0]?.message?.content) {
        throw new Error('服务器响应格式错误');
      }

      const botReply = response.choices[0].message.content;

      setMessages(prev => [...prev, 
        { sender: 'user', text: currentInput },
        { sender: 'bot', text: botReply }
      ]);
      
      setError('');
      setWeeklyUsage(prev => prev + 1);
      
    } catch (err) {
      console.error('[ERROR] 发送消息失败:', {
        error: err instanceof Error ? err.message : '未知错误',
        type: err instanceof Error ? err.name : typeof err
      });
      setInput(currentInput);
      setError(
        err instanceof Error 
          ? (err.name === 'AbortError' 
            ? '请求超时，请稍后重试' 
            : err.message)
          : '发送失败'
      );
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  };

  // 处理选择对话
  const handleSelectThread = async (threadId: string) => {
    setCurrentThreadId(String(threadId));
    await fetchHistory(String(threadId));
  };

  // 创建新对话
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
        <ConversationList
          userId={user.user_id}
          currentThreadId={currentThreadId}
          onSelectThread={handleSelectThread}
          onCreateNewThread={handleCreateNewThread}
        />
      )}
      <div className={styles.chatWindow}>
        <div className={styles.messages}>
          {messages.map((msg, index) => (
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
          ))}
          <div ref={messagesEndRef} />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.inputArea}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
            placeholder="输入消息..."
            className={styles.inputField}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className={styles.sendButton}
          >
            {isLoading ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
