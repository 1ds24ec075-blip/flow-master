import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Mail, Play, Copy, Check, Clock, FileText, ExternalLink, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const GmailIntegration = () => {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const projectUrl = import.meta.env.VITE_SUPABASE_URL || "https://pskuxhpfohmxlhmupeoz.supabase.co";
  const edgeFunctionUrl = `${projectUrl}/functions/v1/process-po`;

  const appsScript = `// Gmail to PO Processor - Google Apps Script
// This script runs automatically to detect and process Purchase Order emails

// Configuration
const EDGE_FUNCTION_URL = "${edgeFunctionUrl}";
const SEARCH_QUERY = 'is:unread subject:(PO OR "purchase order") has:attachment';

function processEmails() {
  const threads = GmailApp.search(SEARCH_QUERY, 0, 10);
  
  if (threads.length === 0) {
    Logger.log('No matching emails found');
    return;
  }
  
  Logger.log('Found ' + threads.length + ' threads to process');
  
  for (const thread of threads) {
    const messages = thread.getMessages();
    
    for (const message of messages) {
      if (message.isUnread()) {
        processMessage(message);
      }
    }
  }
}

function processMessage(message) {
  const attachments = message.getAttachments();
  const pdfAttachments = attachments.filter(att => 
    att.getContentType() === 'application/pdf' || 
    att.getName().toLowerCase().endsWith('.pdf')
  );
  
  if (pdfAttachments.length === 0) {
    Logger.log('No PDF attachments in: ' + message.getSubject());
    return;
  }
  
  for (const pdf of pdfAttachments) {
    try {
      const payload = {
        fileName: pdf.getName(),
        fileData: Utilities.base64Encode(pdf.getBytes()),
        emailSubject: message.getSubject(),
        emailFrom: message.getFrom(),
        emailDate: message.getDate().toISOString()
      };
      
      const options = {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(EDGE_FUNCTION_URL, options);
      const responseCode = response.getResponseCode();
      
      if (responseCode === 200) {
        Logger.log('Successfully processed: ' + pdf.getName());
        message.markRead();
      } else {
        Logger.log('Error processing ' + pdf.getName() + ': ' + response.getContentText());
      }
    } catch (error) {
      Logger.log('Exception processing ' + pdf.getName() + ': ' + error.toString());
    }
  }
}

// Manual trigger function for testing
function testProcessing() {
  Logger.log('Starting manual test...');
  processEmails();
  Logger.log('Test complete. Check the Logs for details.');
}

// Function to set up hourly trigger
function setupHourlyTrigger() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'processEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // Create new hourly trigger
  ScriptApp.newTrigger('processEmails')
    .timeBased()
    .everyHours(1)
    .create();
    
  Logger.log('Hourly trigger set up successfully!');
}`;

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
    toast({
      title: "Copied!",
      description: "Content copied to clipboard",
    });
  };

  const handleTestConnection = async () => {
    if (!testEmail) {
      toast({
        title: "Error",
        description: "Please enter a test email address",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    try {
      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'test.pdf',
          fileData: '',
          emailSubject: 'Test PO Email',
          emailFrom: testEmail,
          emailDate: new Date().toISOString(),
          isTest: true
        })
      });

      if (response.ok) {
        toast({
          title: "Connection Successful!",
          description: "Your edge function is reachable and ready to process PO emails.",
        });
      } else {
        const error = await response.text();
        toast({
          title: "Connection Issue",
          description: error || "Edge function returned an error. Check the logs.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: "Could not reach the edge function. It may not be deployed yet.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gmail Integration</h1>
        <p className="text-muted-foreground">
          Automatically process Purchase Order emails from Gmail using Google Apps Script
        </p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>No OAuth Required</AlertTitle>
        <AlertDescription>
          This method uses Google Apps Script which runs inside your Gmail - no OAuth consent screens, no 403 errors, just simple copy-paste setup.
        </AlertDescription>
      </Alert>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            How It Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-medium">1. Automatic Scanning</h3>
              <p className="text-sm text-muted-foreground">
                Apps Script runs hourly to find unread PO emails with PDF attachments
              </p>
            </div>
            <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-medium">2. PDF Extraction</h3>
              <p className="text-sm text-muted-foreground">
                PDFs are extracted and sent to your backend for AI processing
              </p>
            </div>
            <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-medium">3. Auto-Import</h3>
              <p className="text-sm text-muted-foreground">
                PO data is extracted and saved to your database automatically
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Setup Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Setup Instructions</CardTitle>
          <CardDescription>
            Follow these steps to enable automatic Gmail processing (takes ~2 minutes)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center">1</Badge>
              <h3 className="font-medium">Open Google Apps Script</h3>
            </div>
            <p className="text-sm text-muted-foreground ml-8">
              Go to Google Apps Script and create a new project
            </p>
            <div className="ml-8">
              <Button variant="outline" asChild>
                <a 
                  href="https://script.google.com/home/start" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Google Apps Script
                </a>
              </Button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center">2</Badge>
              <h3 className="font-medium">Create New Project & Paste Script</h3>
            </div>
            <p className="text-sm text-muted-foreground ml-8">
              Click "New Project", delete the default code, and paste the script below
            </p>
            <div className="ml-8 relative">
              <Textarea 
                value={appsScript}
                readOnly
                className="font-mono text-xs h-64 bg-muted"
              />
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={() => copyToClipboard(appsScript, 'script')}
              >
                {copied === 'script' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center">3</Badge>
              <h3 className="font-medium">Save & Authorize</h3>
            </div>
            <div className="ml-8 space-y-2">
              <p className="text-sm text-muted-foreground">
                Save the project (Ctrl+S), then click the dropdown next to "Run" and select <code className="bg-muted px-1 rounded">testProcessing</code>.
              </p>
              <p className="text-sm text-muted-foreground">
                Google will ask you to authorize Gmail access. Click <strong>"Advanced"</strong> → <strong>"Go to [project name] (unsafe)"</strong> → <strong>"Allow"</strong>.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center">4</Badge>
              <h3 className="font-medium">Set Up Automatic Trigger</h3>
            </div>
            <div className="ml-8 space-y-2">
              <p className="text-sm text-muted-foreground">
                Run the <code className="bg-muted px-1 rounded">setupHourlyTrigger</code> function to enable automatic hourly processing.
              </p>
              <p className="text-sm text-muted-foreground">
                Or go to <strong>Triggers</strong> (clock icon on left sidebar) → <strong>Add Trigger</strong> → Set to run <code>processEmails</code> hourly.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Connection */}
      <Card>
        <CardHeader>
          <CardTitle>Test Connection</CardTitle>
          <CardDescription>
            Verify that your backend function is reachable
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Backend Function URL</Label>
            <div className="flex gap-2">
              <Input 
                value={edgeFunctionUrl} 
                readOnly 
                className="font-mono text-sm bg-muted"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(edgeFunctionUrl, 'url')}
              >
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Your Email (for test logging)</Label>
            <div className="flex gap-2">
              <Input 
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="your@email.com"
              />
              <Button onClick={handleTestConnection} disabled={isTesting}>
                <Play className="h-4 w-4 mr-2" />
                {isTesting ? "Testing..." : "Test"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Email Search Criteria</CardTitle>
          <CardDescription>
            The script searches for emails matching these criteria
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Gmail Search Query</Label>
            <Input 
              value='is:unread subject:(PO OR "purchase order") has:attachment'
              readOnly
              className="font-mono text-sm bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              Modify the SEARCH_QUERY variable in the Apps Script to customize which emails are processed
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GmailIntegration;
