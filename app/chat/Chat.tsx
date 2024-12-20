'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';

interface ChatItem {
    Message: string;
    Timestamp: string;
    UserId: string;
}

interface UsageLimit {
    free: number;
    pro: number;
    ultimate: number;
}

const WEEKLY_LIMITS: UsageLimit = {
    free: 10,
    pro: 100,
    ultimate: Infinity
};

const Chat = () => {
    const { userData, loading } = useAuth();
    const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [weeklyUsage, setWeeklyUsage] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(false);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const parseHistoryMessage = (messageStr: string) => {
        try {
            const parsed = JSON.parse(messageStr);
            if (!parsed.userMessage || !parsed.botReply) {
                console.error('Invalid message format:', messageStr);
                return [];
            }
            return [
                { sender: 'user', text: parsed.userMessage },
                { sender: 'bot', text: parsed.botReply }
            ];
        } catch (e) {
            console.error('Failed to parse message:', e);
            return [];
        }
    };

    useEffect(() => {
        async function fetchHistory() {
            if (!userData) return;
            
            try {
                const response = await fetch(`/api/chat?userId=${userData.ID}`);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(`获取聊天历史失败: ${response.status}`);
                }
                
                const allMessages = data.flatMap((item: ChatItem) => 
                    parseHistoryMessage(item.Message)
                );
                setMessages(allMessages);
                scrollToBottom();
            } catch (err) {
                setError(err instanceof Error ? err.message : '加载失败');
            }
        }

        if (userData) {
            fetchHistory();
        }
    }, [userData]);

    useEffect(() => {
        async function fetchWeeklyUsage() {
            if (!userData) return;
            try {
                const response = await fetch(`/api/usage?userId=${userData.ID}`);
                const data = await response.json();
                setWeeklyUsage(data.weeklyCount || 0);
            } catch (err) {
                console.error('获取使用次数失败:', err);
            }
        }

        fetchWeeklyUsage();
    }, [userData]);

    const checkUsageLimit = () => {
        const membershipType = userData?.membershipType || 'free';
        const limit = WEEKLY_LIMITS[membershipType];
        
        if (weeklyUsage >= limit) {
            setError(`本周使用次数已达上限 (${limit}次)。请升级会员以获取更多使用次数。`);
            return false;
        }
        return true;
    };

    const sendMessage = async () => {
        if (!input.trim() || !userData) return;
        
        if (!checkUsageLimit()) return;
        
        setIsLoading(true);
        const currentInput = input;
        setInput('');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    userId: userData.ID,
                    message: currentInput 
                })
            });

            if (!response.ok) {
                throw new Error(await response.text() || '发送失败');
            }

            const data = await response.json();
            setMessages(prev => [...prev, 
                { sender: 'user', text: currentInput },
                { sender: 'bot', text: data.reply }
            ]);
            
            setWeeklyUsage(prev => prev + 1);

        } catch (err) {
            console.error('[ERROR]:', err);
            setError(err instanceof Error ? err.message : '发送失败');
            setInput(currentInput);
        } finally {
            setIsLoading(false);
            scrollToBottom();
        }
    };

    const renderMembershipStatus = () => {
        const membershipType = userData?.membershipType || 'free';
        const limit = WEEKLY_LIMITS[membershipType];
        return (
            <div className={styles.membershipStatus}>
                <p>会员等级: {membershipType.toUpperCase()}</p>
                <p>本周已使用: {weeklyUsage} / {limit === Infinity ? '无限制' : limit}</p>
                {membershipType === 'free' && (
                    <button 
                        className={styles.upgradeButton}
                        onClick={() => window.open('https://ai4kingdom.com/pricing', '_blank')}
                    >
                        升级会员
                    </button>
                )}
            </div>
        );
    };

    if (loading) return <div>加载中...</div>;
    if (!userData) return (
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
        <div className={styles.chatWindow}>
            {renderMembershipStatus()}
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
    );
};

export default Chat;
