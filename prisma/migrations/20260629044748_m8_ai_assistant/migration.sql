-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('INAPP', 'EMAIL', 'WS');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeSource" AS ENUM ('PLAYBOOK', 'SOP', 'UPLOAD');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'INAPP',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiActionLog" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "preview" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "KnowledgeSource" NOT NULL DEFAULT 'UPLOAD',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSettings" (
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "alertCron" TEXT NOT NULL DEFAULT '0 8 * * *',
    "channels" JSONB NOT NULL DEFAULT '{"inapp":true,"email":false}',
    "modelTierReasoning" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    "modelTierCheap" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    "monthlyTokenCap" INTEGER NOT NULL DEFAULT 500000,
    "redactPii" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_createdAt_idx" ON "Notification"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiConversation_projectId_userId_idx" ON "AiConversation"("projectId", "userId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionLog_projectId_status_idx" ON "AiActionLog"("projectId", "status");

-- CreateIndex
CREATE INDEX "AiActionLog_userId_createdAt_idx" ON "AiActionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_projectId_idx" ON "KnowledgeDoc"("projectId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionLog" ADD CONSTRAINT "AiActionLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionLog" ADD CONSTRAINT "AiActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionLog" ADD CONSTRAINT "AiActionLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDoc" ADD CONSTRAINT "KnowledgeDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
