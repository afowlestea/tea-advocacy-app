import { GoogleGenAI, Modality } from '@google/genai';
import React, { useState, useRef, useEffect } from 'react';
import { Settings, BookOpen, ShieldAlert, CheckCircle2, AlertCircle, ChevronRight, RefreshCw, MessageSquare, Bot, Send, Loader2, ArrowLeft, Mic, MicOff, Volume2 } from 'lucide-react';

// --- Audio Utilities for Live API (kept for future WebRTC or custom implementations) ---
// --- Audio Utilities for Live API ---
const workletCode = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function encode(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data) {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

// --- Data: Scenarios and Contexts ---

// Define the different local contexts available
const LOCAL_CONTEXTS = {
  HAS_MOU: 'has_mou',
  NO_MOU: 'no_mou',
  COLLABORATIVE: 'collaborative', // Example of another context type
};

// Define the scenarios
const SCENARIOS = [
  {
    id: 'planning_time',
    title: 'Protecting Planning Time',
    icon: <BookOpen className="w-6 h-6 text-blue-500" />,
    description: 'A principal is consistently pulling a teacher during their scheduled planning time to cover another class due to sub shortages.',
    situations: [
      {
        id: 'step_1',
        prompt: 'A teacher comes to you, frustrated that they have lost their planning time three times this week to cover classes. They are exhausted and falling behind on grading. What is your first step?',
        options: [
          {
            id: 'opt_1a',
            text: 'Immediately file a formal grievance with the district office.',
            feedback: {
              default: 'While action is needed, jumping straight to a formal grievance without gathering facts or attempting informal resolution is usually premature and can damage relationships.',
              isIdeal: false,
            }
          },
          {
            id: 'opt_1b',
            text: 'Tell the teacher to refuse the next request to cover a class.',
            feedback: {
              default: 'This is risky. Advising insubordination could lead to disciplinary action against the teacher. You must protect the member first.',
              isIdeal: false,
            }
          },
          {
            id: 'opt_1c',
            text: 'Sit down with the teacher to gather all facts (dates, times, directives given) and review local policy/agreements.',
            feedback: {
              [LOCAL_CONTEXTS.HAS_MOU]: 'Excellent. This is the crucial first step. Specifically, you should check the MOU article regarding "Duty-Free Planning Time" and any provisions for compensation if planning time is lost.',
              [LOCAL_CONTEXTS.NO_MOU]: 'Excellent. Gathering facts is essential. Without an MOU, you\'ll need to rely on state law (which guarantees 2.5 hours of planning time weekly) and any local school board policies regarding planning time and coverage duties.',
              default: 'Excellent. Gathering facts is the crucial first step before taking action.',
              isIdeal: true,
            },
            nextStep: 'step_2'
          }
        ]
      },
      {
         id: 'step_2',
         prompt: 'You have the facts: the teacher has indeed lost required planning time. You schedule an informal meeting with the principal. How do you open the conversation?',
         options: [
           {
             id: 'opt_2a',
             text: '"You are violating the teacher\'s rights, and if you don\'t stop, we are filing a grievance today."',
             feedback: {
               default: 'Too aggressive for an initial informal meeting. This immediately puts the principal on the defensive and makes collaboration difficult.',
               isIdeal: false
             }
           },
           {
             id: 'opt_2b',
             text: '"We understand the sub shortage is difficult, but Teacher X is losing critical planning time. Can we discuss how to ensure they get their required time?"',
             feedback: {
               [LOCAL_CONTEXTS.HAS_MOU]: 'Good approach. It acknowledges the problem but centers the member\'s rights. Be prepared to reference the specific MOU language if the principal resists.',
               [LOCAL_CONTEXTS.NO_MOU]: 'Good approach. Since you don\'t have an MOU, framing this collaboratively while relying on state law/board policy is your strongest initial tactic.',
               default: 'Good approach. It is professional, addresses the core issue, and seeks a collaborative solution.',
               isIdeal: true
             },
             nextStep: null // End of scenario
           }
         ]
      }
    ]
  },
  {
    id: 'disciplinary_meeting',
    title: '603 Rights & Disciplinary Meetings',
    icon: <ShieldAlert className="w-6 h-6 text-red-500" />,
    description: 'A member has been called into an investigatory meeting with administration that they believe could lead to discipline.',
    situations: [
      {
        id: 'step_1',
        prompt: 'A frantic member calls you. They just received an email to meet with the principal in 10 minutes regarding "parent complaints." They ask what they should do.',
        options: [
          {
            id: 'opt_1a',
            text: 'Tell them to go to the meeting alone and just listen, but not sign anything.',
            feedback: {
              default: 'Incorrect. If the meeting could lead to discipline, the member has the right to representation (603 Rights). They should not go alone.',
              isIdeal: false,
            }
          },
          {
            id: 'opt_1b',
            text: 'Tell them to invoke their 603 Rights and ask to reschedule the meeting so you can be present.',
            feedback: {
               [LOCAL_CONTEXTS.HAS_MOU]: 'Correct. They must invoke their 603 rights. Your MOU likely outlines the specific timeline administration must provide to allow for representation.',
               [LOCAL_CONTEXTS.NO_MOU]: 'Correct. 603 rights apply regardless of an MOU. The member must clearly state they request representation before answering questions.',
               default: 'Correct. They must invoke their 603 rights to secure representation.',
               isIdeal: true,
            },
            nextStep: 'step_2'
          }
        ]
      },
      {
        id: 'step_2',
        prompt: 'You are now sitting in the meeting with the member and the principal. The principal asks the member a direct question about a specific incident. What is your role as the rep?',
        options: [
          {
            id: 'opt_2a',
            text: 'Answer the question for the member to ensure they don\'t say the wrong thing.',
            feedback: {
              default: 'Incorrect. You are a representative, not a proxy. You cannot answer for the member, but you can advise them.',
              isIdeal: false
            }
          },
          {
            id: 'opt_2b',
            text: 'Take notes, object to intimidating questions, ask clarifying questions, and request a private caucus with the member if needed.',
            feedback: {
              default: 'Excellent. This accurately describes the active role of a representative in an investigatory interview.',
              isIdeal: true
            },
            nextStep: null
          }
        ]
      }
    ]
  }
];

const AI_SCENARIOS = [
  {
    id: 'ai_planning_time',
    title: 'Live Roleplay: The Planning Time Dispute',
    icon: <Bot className="w-6 h-6 text-emerald-500" />,
    description: 'Engage in a live chat roleplay with an AI acting as Principal Davis, who has been pulling teachers during planning time.',
    persona: 'Principal Davis',
    initialMessage: "(You walk into Principal Davis's office. She looks up from a stack of paperwork.) Yes, come in. I'm very busy today, what do you need to discuss?",
    promptContext: 'You are Principal Davis, a stressed but professional middle school principal. The user is a building representative from the Tennessee Education Association (TEA). A teacher has complained to the rep because you pulled them from their planning time 3 times this week due to substitute shortages. You are defensive at first because you feel you have no other choice, but you will concede if the rep makes strong, professional arguments referencing policies or member rights. Keep responses brief (1-3 sentences). Let the rep lead the conversation.'
  },
  {
    id: 'ai_disciplinary_hearing',
    title: 'Live Roleplay: Disciplinary Fact-Finding',
    icon: <ShieldAlert className="w-6 h-6 text-red-500" />,
    description: 'Practice representing a member in a fact-finding meeting with HR regarding a parent complaint.',
    persona: 'HR Director Smith',
    initialMessage: "(You and the member are seated across from HR Director Smith.) Thank you both for coming in. We are here to discuss a serious parent complaint regarding the member's conduct on Tuesday. Now, why did you raise your voice at the parent in the hallway?",
    promptContext: 'You are HR Director Smith, conducting a fact-finding disciplinary meeting regarding a teacher (the member) who allegedly spoke unprofessionally to a parent. The user is a building representative from the Tennessee Education Association (TEA) representing the teacher. You are direct and trying to get the teacher to admit fault by asking leading questions. The user\'s job is to protect the member\'s 603 Rights, ask clarifying questions, stop you from badgering the member, and request a caucus if needed. If the user effectively intervenes (e.g., stopping leading questions, clarifying the question), acknowledge their point and adjust your questioning. Keep responses brief (1-3 sentences).'
  }
];

export default function AdvocacyApp() {
  // State for the application
  const [currentView, setCurrentView] = useState('setup'); // 'setup', 'dashboard', 'scenario', 'ai_scenario'
  const [localContext, setLocalContext] = useState(LOCAL_CONTEXTS.HAS_MOU);
  const [activeScenario, setActiveScenario] = useState(null);
  const [currentSituationId, setCurrentSituationId] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [scenarioHistory, setScenarioHistory] = useState([]); // Track progress within a scenario

  // AI Chat State
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const messagesEndRef = useRef(null);

  // Voice Roleplay State & Refs
  const [voiceStatus, setVoiceStatus] = useState('idle'); // 'idle', 'connecting', 'active'
  const [liveTranscripts, setLiveTranscripts] = useState({ input: '', output: '' });
  
  const audioContextRefs = useRef({ input: null, output: null });
  const streamRef = useRef(null);
  const sessionPromiseRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);
  
  const currentInputRef = useRef('');
  const currentOutputRef = useRef('');

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, isAiTyping, liveTranscripts]);

  const handleStartAiScenario = (scenario) => {
    setActiveScenario(scenario);
    setMessages([{ 
      role: 'model', 
      parts: [{ text: scenario.initialMessage }] 
    }]);
    setCurrentView('ai_scenario');
  };

  const stopVoiceSession = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRefs.current.input) {
      audioContextRefs.current.input.close();
      audioContextRefs.current.input = null;
    }
    if (audioContextRefs.current.output) {
      audioContextRefs.current.output.close();
      audioContextRefs.current.output = null;
    }
    
    setVoiceStatus('idle');
    setLiveTranscripts({ input: '', output: '' });
    currentInputRef.current = '';
    currentOutputRef.current = '';
  };

  const startVoiceSession = async () => {
    try {
      setVoiceStatus('connecting');

      // Fetch this from your secure backend or use environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY; 
      const ai = new GoogleGenAI({apiKey: apiKey});

      // 1. Initialize Audio Contexts
      const inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: 16000});
      const outputAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      audioContextRefs.current = { input: inputAudioContext, output: outputAudioContext };

      // 2. Setup Audio Worklet for capturing mic data
      const workletBlob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(workletBlob);
      await inputAudioContext.audioWorklet.addModule(workletUrl);

      const outputNode = outputAudioContext.createGain();
      outputNode.connect(outputAudioContext.destination);

      // 3. Request Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
          }
      });
      streamRef.current = stream;

      // 4. Connect to Gemini Live API
      const sessionPromise = ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        callbacks: {
          onopen: () => {
            setVoiceStatus('active');
            
            // Connect mic to Worklet
            const source = inputAudioContext.createMediaStreamSource(stream);
            const recorder = new AudioWorkletNode(inputAudioContext, 'recorder-processor');

            recorder.port.onmessage = (event) => {
              const inputData = event.data; // Float32Array
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ audio: pcmBlob });
              });
            };

            source.connect(recorder);
            recorder.connect(inputAudioContext.destination);
          },
          onmessage: async (message) => {
             // Handle Transcripts
             if (message.serverContent?.outputTranscription) {
               currentOutputRef.current += message.serverContent.outputTranscription.text;
               setLiveTranscripts(prev => ({ ...prev, output: currentOutputRef.current }));
             } else if (message.serverContent?.inputTranscription) {
               currentInputRef.current += message.serverContent.inputTranscription.text;
               setLiveTranscripts(prev => ({ ...prev, input: currentInputRef.current }));
             }

             if (message.serverContent?.turnComplete) {
                // Save the turn to the chat history
                if (currentInputRef.current || currentOutputRef.current) {
                   setMessages(prev => [
                     ...prev,
                     ...(currentInputRef.current ? [{ role: 'user', parts: [{ text: currentInputRef.current }] }] : []),
                     ...(currentOutputRef.current ? [{ role: 'model', parts: [{ text: currentOutputRef.current }] }] : [])
                   ]);
                   currentInputRef.current = '';
                   currentOutputRef.current = '';
                   setLiveTranscripts({ input: '', output: '' });
                }
             }

            // Handle Audio Output from AI
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                outputAudioContext,
                24000, 
                1
              );
              
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            // Handle Interruptions (AI stops talking if you interrupt)
            if (message.serverContent?.interrupted) {
              for (const source of sourcesRef.current.values()) {
                source.stop();
                sourcesRef.current.delete(source);
              }
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Live API Error:', e);
            setVoiceStatus('idle');
          },
          onclose: () => {
            console.log('Live API Closed');
            stopVoiceSession();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: activeScenario.promptContext + (localContext === LOCAL_CONTEXTS.HAS_MOU ? " The local HAS an MOU." : " The local DOES NOT have an MOU."),
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (err) {
      console.error("Failed to start voice session", err);
      setVoiceStatus('idle');
      alert("Microphone access denied or error connecting to AI.");
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isAiTyping) return;

    const userInput = chatInput;
    setChatInput('');

    if (voiceStatus === 'active' && sessionPromiseRef.current) {
        // Fallback or ignore if live session isn't truly active
        return;
    }

    const newUserMessage = { role: "user", parts: [{ text: userInput }] };
    const newMessages = [...messages, newUserMessage];
    
    setMessages(newMessages);
    setIsAiTyping(true);

    try {
      const apiKey = ""; // API key is injected by the Canvas environment automatically
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      
      const contextDescription = localContext === LOCAL_CONTEXTS.HAS_MOU 
        ? "The local association HAS a negotiated Memorandum of Understanding (MOU) outlining duty-free planning time." 
        : "The local association DOES NOT have an MOU and relies strictly on Tennessee state law (which requires 2.5 hours of planning time weekly) and local board policy.";

      const systemPrompt = `${activeScenario.promptContext} IMPORTANT CONTEXT: ${contextDescription}`;

      const payload = {
        contents: newMessages,
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      if (result.candidates && result.candidates[0]) {
        const aiResponseText = result.candidates[0].content.parts[0].text;
        setMessages([...newMessages, { role: "model", parts: [{ text: aiResponseText }] }]);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages([...newMessages, { role: "model", parts: [{ text: "(System Error: The principal is currently unavailable. Please try again.)" }] }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  // Handle starting a scenario
  const handleStartScenario = (scenario) => {
    setActiveScenario(scenario);
    setCurrentSituationId(scenario.situations[0].id);
    setSelectedOption(null);
    setScenarioHistory([]);
    setCurrentView('scenario');
  };

  // Handle selecting an option within a scenario
  const handleOptionSelect = (option) => {
    setSelectedOption(option);
  };

  // Handle moving to the next step or finishing
  const handleNext = () => {
    // Save current step to history
    setScenarioHistory([...scenarioHistory, { situationId: currentSituationId, option: selectedOption }]);
    
    if (selectedOption.nextStep) {
      setCurrentSituationId(selectedOption.nextStep);
      setSelectedOption(null);
    } else {
      // Scenario complete
      setCurrentSituationId('complete');
    }
  };

  // Handle returning to the dashboard
  const handleReturnToDashboard = () => {
    stopVoiceSession();
    setActiveScenario(null);
    setCurrentSituationId(null);
    setSelectedOption(null);
    setMessages([]);
    setCurrentView('dashboard');
  };

  // --- View Renderers ---

  const renderSetupView = () => (
    <div className="max-w-2xl mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg">
      <div className="flex items-center justify-center mb-6">
        <Settings className="w-10 h-10 text-indigo-600 mr-3" />
        <h1 className="text-3xl font-bold text-gray-800">Local Context Setup</h1>
      </div>
      <p className="text-gray-600 mb-8 text-center text-lg">
        To provide the most accurate guidance, please select the organizing context for your local association.
      </p>

      <div className="space-y-4">
        <button
          onClick={() => { setLocalContext(LOCAL_CONTEXTS.HAS_MOU); setCurrentView('dashboard'); }}
          className="w-full text-left p-5 border-2 border-indigo-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition-all flex items-start"
        >
          <div className="bg-indigo-100 p-2 rounded-full mr-4 mt-1">
            <CheckCircle2 className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-800">We have an MOU</h3>
            <p className="text-gray-600 mt-1">My local has a negotiated Memorandum of Understanding (MOU) with the school board.</p>
          </div>
        </button>

        <button
          onClick={() => { setLocalContext(LOCAL_CONTEXTS.NO_MOU); setCurrentView('dashboard'); }}
          className="w-full text-left p-5 border-2 border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 transition-all flex items-start"
        >
          <div className="bg-slate-200 p-2 rounded-full mr-4 mt-1">
             <AlertCircle className="w-6 h-6 text-slate-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-800">We do NOT have an MOU</h3>
            <p className="text-gray-600 mt-1">My local relies on state law, board policy, and collaborative advocacy without a formal MOU.</p>
          </div>
        </button>
      </div>
    </div>
  );

  const renderDashboardView = () => (
    <div className="max-w-4xl mx-auto mt-8 p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Advocacy Scenarios</h1>
          <p className="text-gray-600 mt-2">
            Current Context: <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
              {localContext === LOCAL_CONTEXTS.HAS_MOU ? 'Has MOU' : 'No MOU'}
            </span>
            <button onClick={() => setCurrentView('setup')} className="ml-3 text-sm text-gray-500 underline hover:text-gray-700">Change</button>
          </p>
        </div>
        <img src="https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Tennessee_Education_Association_logo.svg/200px-Tennessee_Education_Association_logo.svg.png" alt="TEA Logo" className="h-16 opacity-50" onError={(e) => e.target.style.display = 'none'} />
      </div>

      <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">AI Interactive Roleplay</h2>
      <div className="grid md:grid-cols-2 gap-6 mb-10">
        {AI_SCENARIOS.map(scenario => (
          <div key={scenario.id} className="bg-white rounded-xl shadow-md border-2 border-emerald-100 overflow-hidden hover:shadow-lg transition-shadow relative">
            <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg flex items-center">
              <Bot className="w-3 h-3 mr-1" /> AI Powered
            </div>
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="p-3 bg-emerald-50 rounded-lg mr-4">
                  {scenario.icon}
                </div>
                <h2 className="text-xl font-bold text-gray-800">{scenario.title}</h2>
              </div>
              <p className="text-gray-600 mb-6 h-16">{scenario.description}</p>
              <button
                onClick={() => handleStartAiScenario(scenario)}
                className="w-full bg-emerald-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center"
              >
                Start AI Roleplay <ChevronRight className="w-5 h-5 ml-2" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Guided Scenarios</h2>
      <div className="grid md:grid-cols-2 gap-6">
        {SCENARIOS.map(scenario => (
          <div key={scenario.id} className="bg-white rounded-xl shadow-md border border-gray-100 overflow-hidden hover:shadow-lg transition-shadow">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="p-3 bg-gray-50 rounded-lg mr-4">
                  {scenario.icon}
                </div>
                <h2 className="text-xl font-bold text-gray-800">{scenario.title}</h2>
              </div>
              <p className="text-gray-600 mb-6 h-16">{scenario.description}</p>
              <button
                onClick={() => handleStartScenario(scenario)}
                className="w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center"
              >
                Start Practice <ChevronRight className="w-5 h-5 ml-2" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderScenarioView = () => {
    if (!activeScenario) return null;

    if (currentSituationId === 'complete') {
       return (
         <div className="max-w-3xl mx-auto mt-10 p-8 bg-white rounded-xl shadow-lg text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
               <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-4">Scenario Complete</h2>
            <p className="text-gray-600 mb-8 text-lg">You have successfully navigated: <span className="font-semibold">{activeScenario.title}</span>.</p>
            <div className="flex justify-center space-x-4">
               <button
                  onClick={() => handleStartScenario(activeScenario)}
                  className="px-6 py-3 border-2 border-indigo-600 text-indigo-600 font-semibold rounded-lg hover:bg-indigo-50 transition-colors flex items-center"
               >
                 <RefreshCw className="w-5 h-5 mr-2" /> Retry Scenario
               </button>
               <button
                  onClick={handleReturnToDashboard}
                  className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
               >
                 Return to Dashboard
               </button>
            </div>
         </div>
       )
    }

    const currentSituation = activeScenario.situations.find(s => s.id === currentSituationId);
    if (!currentSituation) return <div>Error loading situation.</div>;

    // Helper to get the correct feedback based on local context
    const getFeedbackText = (feedbackObj) => {
      if (feedbackObj[localContext]) {
        return feedbackObj[localContext];
      }
      return feedbackObj.default;
    };

    return (
      <div className="max-w-4xl mx-auto mt-6">
        {/* Scenario Header */}
        <div className="mb-6 flex items-center text-sm text-gray-500 font-medium">
          <button onClick={handleReturnToDashboard} className="hover:text-indigo-600 flex items-center">
            <ChevronRight className="w-4 h-4 mr-1 rotate-180" /> Back to Scenarios
          </button>
          <span className="mx-2">/</span>
          <span className="text-indigo-600">{activeScenario.title}</span>
        </div>

        <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100">
          {/* Situation Prompt */}
          <div className="bg-slate-50 p-6 md:p-8 border-b border-gray-200">
            <div className="flex items-start">
               <MessageSquare className="w-8 h-8 text-slate-400 mr-4 mt-1 flex-shrink-0" />
               <p className="text-xl md:text-2xl text-gray-800 font-medium leading-relaxed">
                 {currentSituation.prompt}
               </p>
            </div>
          </div>

          {/* Options */}
          <div className="p-6 md:p-8 bg-gray-50">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Choose your response:</h3>
            <div className="space-y-4">
              {currentSituation.options.map(option => {
                const isSelected = selectedOption?.id === option.id;
                // Only show styling if it's selected to prevent giving away the answer before click
                const baseClasses = "w-full text-left p-5 rounded-lg border-2 transition-all duration-200 flex flex-col justify-start relative overflow-hidden";
                let conditionalClasses = "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md cursor-pointer";
                
                if (selectedOption) {
                    // Disable other options once one is selected
                    if (!isSelected) {
                        conditionalClasses = "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed";
                    } else {
                        // Style the selected option based on whether it was ideal
                        conditionalClasses = option.feedback.isIdeal 
                            ? "border-green-500 bg-green-50 shadow-md ring-2 ring-green-200" 
                            : "border-orange-500 bg-orange-50 shadow-md ring-2 ring-orange-200";
                    }
                }

                return (
                  <button
                    key={option.id}
                    onClick={() => !selectedOption && handleOptionSelect(option)}
                    disabled={!!selectedOption}
                    className={`${baseClasses} ${conditionalClasses}`}
                  >
                    <span className="text-lg text-gray-800 font-medium mb-2">{option.text}</span>
                    
                    {/* Feedback Reveal */}
                    {isSelected && (
                      <div className={`mt-4 p-4 rounded bg-white border ${option.feedback.isIdeal ? 'border-green-200 text-green-800' : 'border-orange-200 text-orange-800'} animate-fade-in-up`}>
                        <div className="flex items-start">
                            {option.feedback.isIdeal ? (
                                <CheckCircle2 className="w-6 h-6 mr-3 flex-shrink-0 text-green-600 mt-0.5" />
                            ) : (
                                <AlertCircle className="w-6 h-6 mr-3 flex-shrink-0 text-orange-600 mt-0.5" />
                            )}
                            <div>
                                <h4 className="font-bold mb-1">{option.feedback.isIdeal ? 'Good Approach' : 'Review Needed'}</h4>
                                <p className="text-base">{getFeedbackText(option.feedback)}</p>
                            </div>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Next Step Action */}
            {selectedOption && (
              <div className="mt-8 flex justify-end animate-fade-in">
                <button
                  onClick={handleNext}
                  className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 shadow-lg flex items-center"
                >
                  {selectedOption.nextStep ? 'Continue to Next Step' : 'Complete Scenario'} <ChevronRight className="w-5 h-5 ml-2" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAiScenarioView = () => {
    if (!activeScenario) return null;

    return (
      <div className="max-w-4xl mx-auto mt-6 h-[80vh] flex flex-col">
        {/* Scenario Header */}
        <div className="mb-4 flex items-center text-sm text-gray-500 font-medium shrink-0">
          <button onClick={handleReturnToDashboard} className="hover:text-indigo-600 flex items-center">
            <ArrowLeft className="w-4 h-4 mr-1" /> End Roleplay
          </button>
          <span className="mx-2">/</span>
          <span className="text-emerald-600 font-bold">{activeScenario.title}</span>
        </div>

        {/* Chat Interface */}
        <div className="flex-1 bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 flex flex-col">
          {/* Top Bar */}
          <div className="bg-slate-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mr-3">
                <Bot className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800">{activeScenario.persona}</h3>
                <p className="text-xs text-gray-500">Local Context: {localContext === LOCAL_CONTEXTS.HAS_MOU ? 'MOU Active' : 'No MOU (State Law Only)'}</p>
              </div>
            </div>
            <div className="text-xs bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-medium flex items-center">
               <Bot className="w-3 h-3 mr-1" /> AI Active
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-6">
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg text-sm text-blue-800 mb-6 flex items-start shadow-sm">
               <ShieldAlert className="w-5 h-5 mr-3 shrink-0 text-blue-600" />
               <p><strong>Goal:</strong> {activeScenario.id === 'ai_planning_time' ? 'Professionally address the planning time issue. Remember your specific local context when citing rules or agreements. You are the rep, leading this conversation.' : 'Protect the member\'s 603 Rights during this fact-finding meeting. Intercept inappropriate/leading questions, clarify issues, and request a caucus if needed.'}</p>
            </div>

            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              return (
                <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-4 shadow-sm ${
                    isUser 
                      ? 'bg-indigo-600 text-white rounded-tr-sm' 
                      : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
                  }`}>
                    {msg.parts[0].text}
                  </div>
                </div>
              );
            })}
            
            {isAiTyping && (
              <div className="flex justify-start animate-fade-in-up">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm flex items-center space-x-2">
                  <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                  <span className="text-gray-500 text-sm font-medium">{activeScenario.persona} is typing...</span>
                </div>
              </div>
            )}

            {/* Live Voice Transcripts */}
            {voiceStatus === 'active' && (
              <>
                {liveTranscripts.input && (
                  <div className="flex justify-end animate-fade-in-up opacity-70">
                    <div className="max-w-[80%] rounded-2xl px-5 py-4 shadow-sm bg-indigo-600 text-white rounded-tr-sm">
                      <span className="animate-pulse mr-2">🎤</span> {liveTranscripts.input}
                    </div>
                  </div>
                )}
                {liveTranscripts.output && (
                  <div className="flex justify-start animate-fade-in-up opacity-70">
                    <div className="max-w-[80%] rounded-2xl px-5 py-4 shadow-sm bg-white border border-gray-200 text-gray-800 rounded-tl-sm flex flex-col">
                      <div className="flex items-center text-emerald-600 text-xs font-bold mb-1"><Volume2 className="w-3 h-3 mr-1 animate-pulse" /> PRINCIPAL SPEAKING</div>
                      {liveTranscripts.output}
                    </div>
                  </div>
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="bg-white border-t border-gray-200 p-4 shrink-0 flex flex-col items-center">
            
            {voiceStatus === 'idle' && (
              <button
                onClick={startVoiceSession}
                className="w-full max-w-md mb-4 bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-emerald-700 shadow-lg flex items-center justify-center transition-colors"
              >
                <Mic className="w-5 h-5 mr-2" /> Start Voice Roleplay
              </button>
            )}

            {voiceStatus === 'connecting' && (
              <div className="w-full max-w-md mb-4 bg-emerald-100 text-emerald-700 font-bold py-3 px-6 rounded-lg flex items-center justify-center">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Connecting to Principal...
              </div>
            )}

            {voiceStatus === 'active' && (
               <button
                 onClick={stopVoiceSession}
                 className="w-full max-w-md mb-4 bg-red-100 text-red-700 hover:bg-red-200 border border-red-300 font-bold py-3 px-6 rounded-lg shadow-sm flex items-center justify-center transition-colors animate-pulse"
               >
                 <MicOff className="w-5 h-5 mr-2" /> Stop Voice Roleplay
               </button>
            )}

            <div className="w-full flex items-center space-x-3 text-sm text-gray-400 my-2">
              <div className="flex-1 border-b border-gray-200"></div>
              <span>OR TYPE</span>
              <div className="flex-1 border-b border-gray-200"></div>
            </div>

            <form onSubmit={handleSendMessage} className="flex items-center space-x-3 w-full max-w-3xl mx-auto">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={voiceStatus === 'active' ? "Type to interrupt or add a thought..." : "Type your response as the Association Rep..."}
                disabled={isAiTyping && voiceStatus !== 'active'}
                className="flex-1 bg-gray-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-lg px-4 py-3 text-gray-800 transition-all outline-none"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || (isAiTyping && voiceStatus !== 'active')}
                className={`p-3 rounded-lg flex items-center justify-center transition-colors shadow-sm
                  ${!chatInput.trim() || (isAiTyping && voiceStatus !== 'active') 
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-12">
      {/* App Header */}
      <header className="bg-indigo-700 text-white py-4 shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
             <div className="bg-white p-1 rounded">
               <ShieldAlert className="w-6 h-6 text-indigo-700" />
             </div>
             <h1 className="text-xl font-bold tracking-tight">TEA Rep Ready</h1>
          </div>
          {currentView !== 'setup' && (
            <div className="text-sm bg-indigo-800 py-1 px-3 rounded-full border border-indigo-600">
               Context: {localContext === LOCAL_CONTEXTS.HAS_MOU ? 'MOU Active' : 'No MOU'}
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="px-4">
        {currentView === 'setup' && renderSetupView()}
        {currentView === 'dashboard' && renderDashboardView()}
        {currentView === 'scenario' && renderScenarioView()}
        {currentView === 'ai_scenario' && renderAiScenarioView()}
      </main>
      
      {/* Global Styles for simple animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.4s ease-out forwards;
        }
        .animate-fade-in {
            animation: fadeIn 0.4s ease-out forwards;
        }
      `}} />
    </div>
  );
}