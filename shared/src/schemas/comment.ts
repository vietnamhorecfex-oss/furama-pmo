/**
 * Comment DTOs (zod). Body is bounded 1–4000 chars + sanitised on the server.
 */
import { z } from 'zod';
import { commentBodySchema } from './common';

export const addCommentSchema = z.object({ body: commentBodySchema }).strict();
export type AddCommentDto = z.infer<typeof addCommentSchema>;

export const commentDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  authorId: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type CommentDto = z.infer<typeof commentDtoSchema>;
