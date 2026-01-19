import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Loader2, Database, TrendingUp, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  function_calls?: any;
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
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error loading conversations:', error);
        return;
      }

      if (data) {
        setConversations(data);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading messages:', error);
        return;
      }

      if (data) {
        const typedMessages: Message[] = data.map(m => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          function_calls: m.function_calls,
          created_at: m.created_at
        }));
        setMessages(typedMessages);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setInput("");
  };

  const deleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Delete messages first (foreign key constraint)
      await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId);

      // Then delete conversation
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (error) throw error;

      // Update UI
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      
      // If we deleted the current conversation, clear the chat
      if (currentConversationId === conversationId) {
        setCurrentConversationId(null);
        setMessages([]);
      }

      toast({
        title: "Conversation deleted",
        description: "The conversation has been removed.",
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      toast({
        title: "Error",
        description: "Failed to delete conversation.",
        variant: "destructive",
      });
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    const tempUserMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempUserMessage]);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/tally-ai-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
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

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.response || 'Sorry, I could not generate a response.',
        function_calls: result.functionCalls || null,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (!currentConversationId && result.conversationId) {
        setCurrentConversationId(result.conversationId);
        loadConversations();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorDetails = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorDetails}. Please try again.`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMessage]);
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

  const selectConversation = async (conv: Conversation) => {
    setCurrentConversationId(conv.id);
    await loadMessages(conv.id);
  };

  const renderFunctionCallResult = (functionCall: any) => {
    const { name, result } = functionCall;

    return (
      <div className="mt-2 p-3 rounded-md bg-background/50 border border-border space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Database className="h-3 w-3" />
          {name.replace(/_/g, ' ').toUpperCase()}
        </div>

        {name === 'get_invoice_stats' && result.client_invoices && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Client Invoices:</span>
              <Badge variant="secondary">{result.client_invoices.total_count}</Badge>
            </div>
            {result.client_invoices.pending_count > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending:</span>
                <Badge variant="outline">{result.client_invoices.pending_count}</Badge>
              </div>
            )}
          </div>
        )}

        {name === 'get_invoice_stats' && result.raw_material_invoices && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Raw Material Invoices:</span>
              <Badge variant="secondary">{result.raw_material_invoices.total_count}</Badge>
            </div>
            {result.raw_material_invoices.pending_count > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending:</span>
                <Badge variant="outline">{result.raw_material_invoices.pending_count}</Badge>
              </div>
            )}
          </div>
        )}

        {name === 'get_client_info' && result.clients && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Clients:</span>
              <Badge variant="secondary">{result.total_count}</Badge>
            </div>
            {result.clients.length > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                Recent: {result.clients.map((c: any) => c.name).slice(0, 3).join(', ')}
              </div>
            )}
          </div>
        )}

        {name === 'get_supplier_info' && result.suppliers && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Suppliers:</span>
              <Badge variant="secondary">{result.total_count}</Badge>
            </div>
            {result.suppliers.length > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                Recent: {result.suppliers.map((s: any) => s.name).slice(0, 3).join(', ')}
              </div>
            )}
          </div>
        )}

        {name === 'get_po_stats' && result.purchase_orders && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total POs:</span>
              <Badge variant="secondary">{result.total_count}</Badge>
            </div>
            <div className="flex gap-2 text-xs">
              {result.draft_count > 0 && <Badge variant="outline">Draft: {result.draft_count}</Badge>}
              {result.sent_count > 0 && <Badge variant="outline">Sent: {result.sent_count}</Badge>}
            </div>
          </div>
        )}

        {name === 'get_document_stats' && result.documents && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Documents:</span>
              <Badge variant="secondary">{result.total_count}</Badge>
            </div>
            {result.error_count > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Errors:</span>
                <Badge variant="destructive">{result.error_count}</Badge>
              </div>
            )}
          </div>
        )}

        {name === 'get_approval_stats' && result.approvals && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Approvals:</span>
              <Badge variant="secondary">{result.total_count}</Badge>
            </div>
            <div className="flex gap-2 text-xs">
              {result.pending_count > 0 && <Badge variant="outline">Pending: {result.pending_count}</Badge>}
              {result.approved_count > 0 && <Badge variant="outline">Approved: {result.approved_count}</Badge>}
            </div>
          </div>
        )}

        {name === 'get_recent_activity' && result.activities && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recent Activities:</span>
              <Badge variant="secondary">{result.activities.length}</Badge>
            </div>
          </div>
        )}

        {name === 'get_bank_statement_stats' && result.statements && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bank Statements:</span>
              <Badge variant="secondary">{result.total_count}</Badge>
            </div>
          </div>
        )}

        {name === 'get_system_summary' && result.entities && (
          <div className="space-y-1 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Clients:</span>
                <Badge variant="secondary">{result.entities.clients}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Suppliers:</span>
                <Badge variant="secondary">{result.entities.suppliers}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client Invoices:</span>
                <Badge variant="secondary">{result.entities.client_invoices}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">POs:</span>
                <Badge variant="secondary">{result.entities.purchase_orders}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Documents:</span>
                <Badge variant="secondary">{result.entities.documents}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Approvals:</span>
                <Badge variant="secondary">{result.entities.approvals}</Badge>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">TallyAI Assistant</h1>
        <p className="text-muted-foreground mt-2">
          Your intelligent assistant for accounting, GST, and system insights
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
                    <div key={conv.id} className="flex items-center gap-1 group">
                      <Button
                        onClick={() => selectConversation(conv)}
                        variant={currentConversationId === conv.id ? "secondary" : "ghost"}
                        className="flex-1 justify-start text-left"
                      >
                        <div className="truncate">
                          {conv.title}
                        </div>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete this conversation and all its messages. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => deleteConversation(conv.id, e)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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
                Ask about your data, accounting, GST, and business insights
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
                        Ask me about your system data, accounting, GST, or business finance.
                        <br />
                        I can access real-time data to provide accurate answers.
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1 max-w-md">
                      <p className="font-semibold flex items-center gap-2 justify-center">
                        <TrendingUp className="h-3 w-3" />
                        Try asking:
                      </p>
                      <p>"How many invoices were processed today?"</p>
                      <p>"Who are my recent clients?"</p>
                      <p>"What's the status of pending approvals?"</p>
                      <p>"Show me recent document uploads"</p>
                      <p>"What is the GST rate for textile products?"</p>
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
                          {message.role === 'assistant' && message.function_calls && message.function_calls.length > 0 && (
                            <div className="space-y-2 mt-2">
                              {message.function_calls.map((fc: any, idx: number) => (
                                <div key={idx}>
                                  {renderFunctionCallResult(fc)}
                                </div>
                              ))}
                            </div>
                          )}
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
                  placeholder="Ask about your data or general accounting questions..."
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
