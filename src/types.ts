export interface GenerateQuestRequest {
  questIntention: string;
  previousMemories?: string[];
}

export interface GenerateQuestResponse {
  questText: string;
  audioUrl: string;
}

export interface MemoryCard {
  photoUrl: string;
  experienceText: string;
  reflectionText: string;
  reflectionAudioUrl: string;
  timestamp: string;
}

export interface ProcessMemoryResponse {
  success: true;
  memoryCard: MemoryCard;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
}

export interface MemoryRecord {
  photoPath: string;
  photoUrl: string;
  questText: string;
  experienceText: string;
  reflectionText: string;
  reflectionAudioPath: string;
  reflectionAudioUrl: string;
  createdAt: Date;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
}
