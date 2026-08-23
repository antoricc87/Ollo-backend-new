import axios from "axios";
import dotenv from "dotenv";
import moment from "moment";

dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;

export const searchYouTube = async (query: string, duration: string) => {
  const url = `https://www.googleapis.com/youtube/v3/search`;
  const lastYear = moment().subtract(1, "years").toISOString();
  try {
    const response = await axios.get(url, {
      params: {
        part: "snippet",
        q: query,
        key: API_KEY,
        maxResults: 5,
        type: "video",
        publishedAfter: lastYear,
        order: "relevance",
        videoDuration: duration,
      },
    });

    // Display results with video URL
    response.data.items.forEach((video) => {
      const videoId = video.id.videoId;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching YouTube data:", error);
  }
};

export const searchYouTubeShort = async (
  query: string,
  duration: string | "short"
) => {
  const url = `https://www.googleapis.com/youtube/v3/search`;
  const lastYear = moment().subtract(1, "years").toISOString();
  try {
    const response = await axios.get(url, {
      params: {
        part: "snippet",
        q: query,
        key: API_KEY,
        maxResults: 1,
        type: "video",
        publishedAfter: lastYear,
        order: "relevance",
        videoDuration: duration,
      },
    });

    // Display results with video URL
    response.data.items.forEach((video) => {
      const videoId = video.id.videoId;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(videoUrl);
    });

    return response.data;
  } catch (error) {
    console.error("Error fetching YouTube data:", error);
  }
};
