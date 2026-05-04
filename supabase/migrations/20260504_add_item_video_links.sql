-- Add social media video URL fields to items
ALTER TABLE public.items
    ADD COLUMN IF NOT EXISTS facebook_video_url TEXT,
    ADD COLUMN IF NOT EXISTS instagram_video_url TEXT,
    ADD COLUMN IF NOT EXISTS youtube_video_url TEXT;
