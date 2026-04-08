import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Loader2, Trash2, Zap, Wrench, Brain } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  function_calls?: any[];
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
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, activeTools]);

  const scrollToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const loadConversations = async () => {
    const { data } = await supabase.from("conversations").select("*").order("updated_at", { ascending: false }).limit(20);
    if (data) setConversations(data);
  };

  const loadMessages = async (conversationId: string) => {
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
    if (data) {
      setMessages(data.map(m => ({
        id: m.id, role: m.role as "user" | "assistant", content: m.content,
        function_calls: m.function_calls as any[], created_at: m.created_at,
      })));
    }
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setInput("");
  };

  const deleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from("messages").delete().eq("conversation_id", conversationId);
    const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
    if (error) { toast({ title: "Error", description: "Failed to delete.", variant: "destructive" }); return; }
    setConversations(prev => prev.filter(c => c.id !== conversationId));
    if (currentConversationId === conversationId) { setCurrentConversationId(null); setMessages([]); }
    toast({ title: "Deleted", description: "Conversation removed." });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);
    setActiveTools([]);

    const tempMsg: Message = { id: crypto.randomUUID(), role: "user", content: userMessage, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tally-ai-chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: userMessage, conversationId: currentConversationId }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error("Rate limit exceeded. Please wait a moment.");
        if (response.status === 402) throw new Error("AI credits exhausted. Add funds in Settings > Workspace > Usage.");
        throw new Error("Failed to get response");
      }

      const result = await response.json();

      if (result.toolsUsed?.length) setActiveTools(result.toolsUsed);

      const assistantMsg: Message = {
        id: crypto.randomUUID(), role: "assistant",
        content: result.response || "Sorry, I could not generate a response.",
        function_calls: result.functionCalls || null,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (!currentConversationId && result.conversationId) {
        setCurrentConversationId(result.conversationId);
        loadConversations();
      }
    } catch (error) {
      const errorMsg: Message = {
        id: crypto.randomUUID(), role: "assistant",
        content: `⚠️ ${error instanceof Error ? error.message : "Unknown error"}`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      setTimeout(() => setActiveTools([]), 5000);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-8 w-8 text-primary" />
          TalligenceAI
        </h1>
        <p className="text-muted-foreground mt-1">
          Agentic AI assistant with MCP-powered real-time data access
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Conversations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={startNewConversation} variant="outline" className="w-full justify-start text-sm">
                + New Conversation
              </Button>
              <ScrollArea className="h-[400px]">
                <div className="space-y-1">
                  {conversations.map((conv) => (
                    <div key={conv.id} className="flex items-center gap-1 group">
                      <Button
                        onClick={() => { setCurrentConversationId(conv.id); loadMessages(conv.id); }}
                        variant={currentConversationId === conv.id ? "secondary" : "ghost"}
                        className="flex-1 justify-start text-left text-xs h-8"
                      >
                        <span className="truncate">{conv.title}</span>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete this conversation.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={(e) => deleteConversation(conv.id, e)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* MCP Tools Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                MCP Tools
              </CardTitle>
              <CardDescription className="text-xs">Available agent capabilities</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {["system_summary", "invoices", "clients", "suppliers", "POs", "inventory", "approvals", "bank", "liquidity", "products", "customers", "activity", "quotations", "segregation", "unmapped", "reorder", "approve"].map((tool) => (
                  <Badge key={tool} variant={activeTools.some(t => t.toLowerCase().includes(tool.toLowerCase())) ? "default" : "outline"} className="text-[10px] transition-all">
                    {tool}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chat Area */}
        <div className="lg:col-span-3">
          <Card className="h-[700px] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bot className="h-5 w-5" />
                Agent Chat
                {activeTools.length > 0 && (
                  <Badge variant="secondary" className="text-xs animate-pulse">
                    <Zap className="h-3 w-3 mr-1" />
                    {activeTools.length} tool{activeTools.length > 1 ? "s" : ""} used
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col overflow-hidden">
              <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-12">
                    <div className="relative">
                      <Brain className="h-16 w-16 text-primary/30" />
                      <Zap className="h-6 w-6 text-primary absolute -top-1 -right-1" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">TalligenceAI — Agentic Assistant</h3>
                      <p className="text-sm text-muted-foreground mt-2">
                        I use MCP tools to access your real-time business data and take actions.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-w-lg">
                      {[
                        "Give me a full system summary",
                        "Which inventory items are low on stock?",
                        "Show pending approvals and their details",
                        "Analyze my cash flow for this month",
                        "Find all invoices pending this week",
                        "What are the top clients by invoice count?",
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => { setInput(suggestion); }}
                          className="text-xs text-left p-2 rounded-md border border-border hover:bg-accent transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div key={message.id} className={`flex gap-3 ${message.role === "assistant" ? "justify-start" : "justify-end"}`}>
                        {message.role === "assistant" && (
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div className={`rounded-lg px-4 py-3 max-w-[80%] ${message.role === "assistant" ? "bg-muted" : "bg-primary text-primary-foreground"}`}>
                          {message.role === "assistant" ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                              <ReactMarkdown>{message.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                          )}
                          {message.function_calls && message.function_calls.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
                              <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                                <Wrench className="h-3 w-3" /> MCP TOOLS EXECUTED
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {message.function_calls.map((fc: any, idx: number) => (
                                  <Badge key={idx} variant="outline" className="text-[10px]">
                                    {fc.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {message.role === "user" && (
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
                        <div className="rounded-lg px-4 py-3 bg-muted space-y-2">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs text-muted-foreground">
                              {activeTools.length > 0 ? `Executing ${activeTools.length} MCP tools...` : "Thinking..."}
                            </span>
                          </div>
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
                  placeholder="Ask about your data or request an action..."
                  className="min-h-[60px] max-h-[120px]"
                  disabled={isLoading}
                />
                <Button onClick={sendMessage} disabled={!input.trim() || isLoading} size="icon" className="h-[60px] w-[60px]">
                  {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
