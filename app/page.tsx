"use client";

import { useState, useEffect } from "react";
import "./app.css";
import Chat from "./chat/Chat";
import { AuthProvider } from "./contexts/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function Page() {
  useEffect(() => {
    window.scrollTo = () => {};
    document.body.style.overflow = 'hidden';
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <main style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          zIndex: 1000
        }}>
          <div style={{ 
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden'
          }}>
            <div className="chat-container" style={{
              height: '100%',
              maxHeight: '100vh',
              overflow: 'auto'
            }}>
              <Chat />
            </div>
          </div>
        </main>
      </AuthProvider>
    </ErrorBoundary>
  );
}