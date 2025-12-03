import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export default function TallyAI() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId);
    }
  }, [currentConversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const loadConversations = async () => {
    try {
      const { data, error } = await supabase
        .from('tally_ai_conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(10);

      if (!error && data) {
        setConversations(data);
      } else if (error) {
        console.error('Error loading conversations:', error);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from('tally_ai_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setMessages(data);
      } else if (error) {
        console.error('Error loading messages:', error);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setInput("");
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    const tempUserMessage: Message = {
      id: 'temp-user',
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempUserMessage]);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/tally-ai-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          conversationId: currentConversationId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response from TallyAI');
      }

      const result = await response.json();

      if (!currentConversationId) {
        setCurrentConversationId(result.conversationId);
        await loadConversations();
      }

      await loadMessages(result.conversationId);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorDetails = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: Message = {
        id: 'temp-error',
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorDetails}. Please refresh the page and try again.`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev.filter(m => m.id !== 'temp-user'), errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">TallyAI Assistant</h1>
        <p className="text-muted-foreground mt-2">
          Your AI-powered accounting and GST advisor
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Conversations</CardTitle>
              <CardDescription>Recent chat history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                onClick={startNewConversation}
                variant="outline"
                className="w-full justify-start"
              >
                + New Conversation
              </Button>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {conversations.map((conv) => (
                    <Button
                      key={conv.id}
                      onClick={() => setCurrentConversationId(conv.id)}
                      variant={currentConversationId === conv.id ? "secondary" : "ghost"}
                      className="w-full justify-start text-left"
                    >
                      <div className="truncate">
                        {conv.title}
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="h-[700px] flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                TallyAI Chat
              </CardTitle>
              <CardDescription>
                Ask questions about accounting, GST, and business finance
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col overflow-hidden">
              <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-12">
                    <Bot className="h-16 w-16 text-muted-foreground" />
                    <div>
                      <h3 className="text-lg font-semibold">Welcome to TallyAI</h3>
                      <p className="text-sm text-muted-foreground mt-2">
                        Ask me anything about accounting, GST, or business finance.
                        <br />
                        I provide accurate, CA-level advice without hallucinating data.
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="font-semibold">Try asking:</p>
                      <p>"What is the GST rate for textile products?"</p>
                      <p>"How do I calculate input tax credit?"</p>
                      <p>"What is the difference between CGST and SGST?"</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message, index) => (
                      <div
                        key={message.id || index}
                        className={`flex gap-3 ${
                          message.role === 'assistant' ? 'justify-start' : 'justify-end'
                        }`}
                      >
                        {message.role === 'assistant' && (
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={`rounded-lg px-4 py-2 max-w-[80%] ${
                            message.role === 'assistant'
                              ? 'bg-muted'
                              : 'bg-primary text-primary-foreground'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        {message.role === 'user' && (
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                            <User className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div className="rounded-lg px-4 py-2 bg-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className="mt-4 flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask a question about accounting, GST, or business finance..."
                  className="min-h-[60px] max-h-[120px]"
                  disabled={isLoading}
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  size="icon"
                  className="h-[60px] w-[60px]"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
