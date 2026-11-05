// Investigate why a customer failed to sync between a CRM and an ERP in run 123, then propose a fix
// https://platform.claude.com/docs/en/api/typescript/messages/create
// https://platform.claude.com/docs/en/build-with-claude/working-with-messages
// https://til.simonwillison.net/llms/python-react-pattern
// https://docs.google.com/document/d/e/2PACX-1vR2pDSHu5-4O6hprpHkvWTr_wUqkalYjLZ78DZ7PJNAC_nYbiqVUPkcbYLEa_amzMSPw_4RMxHF8j_8/pub

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY
const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'

if (!apiKey) throw new Error('model config missing')

const LLM = new Anthropic({ apiKey });
const SYS_PROMPT = `
    You're an agent dedicated to diagnosing mapping errors between business applications.
    You run in a loop of Thought, Action, PAUSE, Observation.
    At the end of the loop you output an Answer
    Use Thought to describe your thoughts about how to investigate and diagnose the issue you've been provided, then propose a fix.
    Use Action to run one of the actions available to you - then return PAUSE.
    Observation will be the result of running those actions.
    
    You have the following actions at your disposal:

    getSyncError: runId
    Retrieve the sync run error by run id and inspect it's associated error message
    example: "Invalid subsidiary reference"

    searchGoogle: errorMsg
    Research the error message online

    searchDocumentation: businessApplication
    Pull in api docs for respective business application and record type

    Example Session:

    Question: Investigate why a customer failed to sync between a CRM and an ERP, then propose a fix.
    Thought: To diagnose I should locate error message for respective run
    Action: getSyncError: runId
    PAUSE

    You will then be called again with the observed action data.

    Observation: "Invalid subsidiary reference"

    You then decide whether that is the final answer, or whether further investigation is needed.
`
const SUPPORTED_ACTIONS: Record<string, (input: string) => string> = {
    getSyncError: (input) => {
        const runId = Number(input);

        if (!input.trim() || !Number.isInteger(runId) || runId <= 0) {
            throw new Error("Expected a positive integer run ID");
        }

        return `Error for run ${runId}: waaa`;
    },

    searchGoogle: (searchTerm) => "google searched!",

    searchDocumentation: () => "docs found",
};

class MyAgent {
    sysPrompt: string = "";
    session: Anthropic.MessageParam[] = [];

    constructor(sysPrompt: string) {
        if (sysPrompt.length) {
            this.sysPrompt = sysPrompt;
        }
        console.log('intialized')
    }

    async invoke(usrPrompt: string) {
        const usrMsg: Anthropic.MessageParam = {role: 'user', content: usrPrompt}
        this.session.push(usrMsg)
        const output = await this.modelCall()
        const textOut = output.content
            .map(block => block.type === "text" ? block.text : "")
            .filter(text => text.length > 0)
            .join("\n");
        const assistMsg: Anthropic.MessageParam = {role: 'assistant', content: textOut}
        this.session.push(assistMsg)
        return textOut
    }

    async modelCall() {
        const output = await LLM.messages.create({
            model,
            max_tokens: 10000,
            messages: this.session,
            system: this.sysPrompt
        })
        return output
    }

    next(output: string): { name: string; input: string } | null  {
        const match = output.match(
            /^\s*(?:\*\*)?Action:(?:\*\*)?\s*(\w+):\s*(.+)$/m
        );

        if (!match) return null;

        return {
            name: match[1],
            input: match[2].trim(),
        };
    }
}

async function query(prompt: string, maxTries = 5) {
    const reActAgent = new MyAgent(SYS_PROMPT)
    let nextPrompt = prompt;
    let i = 0;
    while (i < maxTries) {
        i++;
        const output = await reActAgent.invoke(nextPrompt)
        console.log(output);
        const proceed = reActAgent.next(output)
        console.log('action?', proceed)
        if (!proceed) return
        const runAction = Object.hasOwn(SUPPORTED_ACTIONS, proceed.name)
            ? SUPPORTED_ACTIONS[proceed.name]
            : undefined;
        if (!runAction) {
            throw new Error(`Unsupported action: ${proceed.name}`);
        }
        const observation = runAction(proceed.input);
        console.log(`observation: ${observation}`)
        nextPrompt = `Observation: ${observation}`
    }
    console.log(reActAgent.session)
}

async function main() {
    query("Investigate why a customer failed to sync between a CRM and an ERP in run 123, then propose a fix")
}

main().catch(console.error)