export function resolveModelParams(modelStr) {
    let m = (modelStr || '').toLowerCase();
    
    // Default fallback values matching latest Ernie cURL
    let params = {
        model: 'EB50', 
        deepThoughtStatus: 0, // 0 = off, 1 = normal thinking, 3 = slow/deep thinking
        webSearch: 0 // 0 = off, 1 = on
    };

    // Parsing model version
    if (m.includes('eb5.1') || m.includes('eb51')) params.model = 'EB51';
    
    // Parsing thinking (-Think, -Thinking, -Slow)
    if (m.includes('thinking') || m.includes('think') || m.includes('reasoner')) params.deepThoughtStatus = 1;
    if (m.includes('slow')) params.deepThoughtStatus = 3;
    
    // Parsing search (-Search)
    if (m.includes('search')) params.webSearch = 1;

    return params;
}

export function buildFullContext(messages) {
    let context = '';
    for (const msg of messages) {
        if (!msg.content) continue;
        let role = msg.role === 'user' ? 'User' : (msg.role === 'assistant' ? 'Assistant' : 'System');
        context += `[${role}]:\n${msg.content}\n\n`;
    }
    return context.trim();
}

export function buildOpenAIChunk(responseId, model, delta, finishReason = null) {
    return `data: ${JSON.stringify({
        id: responseId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: delta,
            finish_reason: finishReason
        }]
    })}\n\n`;
}
