import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

import {
    AgentRuntime,
    elizaLogger,
    getEnvVariable,
    validateCharacterConfig,
} from "@elizaos/core";

import { DirectClient } from ".";
import { TwitterPostClient } from "@elizaos/client-twitter";

export function createApiRouter(
    agents: Map<string, AgentRuntime>,
    directClient: DirectClient
) {
    const router = express.Router();

    router.use(cors());
    router.use(bodyParser.json());
    router.use(bodyParser.urlencoded({ extended: true }));
    router.use(
        express.json({
            limit: getEnvVariable("EXPRESS_MAX_PAYLOAD") || "100kb",
        })
    );

    router.get("/", (req, res) => {
        res.send("Welcome, this is the REST API!");
    });

    router.get("/hello", (req, res) => {
        res.json({ message: "Hello World!" });
    });

    router.get("/agents", (req, res) => {
        const agentsList = Array.from(agents.values()).map((agent) => ({
            id: agent.agentId,
            name: agent.character.name,
            clients: Object.keys(agent.clients),
        }));
        res.json({ agents: agentsList });
    });

    router.get("/agents/:agentId", (req, res) => {
        const agentId = req.params.agentId;
        const agent = agents.get(agentId);

        if (!agent) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        res.json({
            id: agent.agentId,
            character: agent.character,
        });
    });

    router.post("/agents/:agentId/set", async (req, res) => {
        const agentId = req.params.agentId;
        console.log("agentId", agentId);
        let agent: AgentRuntime = agents.get(agentId);

        // update character
        if (agent) {
            // stop agent
            agent.stop();
            directClient.unregisterAgent(agent);
            // if it has a different name, the agentId will change
        }

        // load character from body
        const character = req.body;
        try {
            validateCharacterConfig(character);
        } catch (e) {
            elizaLogger.error(`Error parsing character: ${e}`);
            res.status(400).json({
                success: false,
                message: e.message,
            });
            return;
        }

        // start it up (and register it)
        agent = await directClient.startAgent(character);
        elizaLogger.log(`${character.name} started`);

        res.json({
            id: character.id,
            character: character,
        });
    });

    router.get("/agents/:agentId/channels", async (req, res) => {
        const agentId = req.params.agentId;
        const runtime = agents.get(agentId);

        if (!runtime) {
            res.status(404).json({ error: "Runtime not found" });
            return;
        }

        // Return empty channels list since Discord is removed
        res.json({
            id: runtime.agentId,
            guilds: [],
            serverCount: 0
        });
    });

    router.get("/agents/:agentId/pending-tweets", (req, res) => {
        const agentId = req.params.agentId;
        const runtime = agents.get(agentId);

        if (!runtime) {
            res.status(404).json({ error: "Runtime not found" });
            return;
        }

        const twitterClient = runtime.clients.twitter as TwitterPostClient;
        const pendingTweets = Array.from(twitterClient.pendingTweets.entries())
            .map(([id, tweet]) => ({
                id,
                ...tweet
            }));

        res.json({ pendingTweets });
    });

    router.post("/agents/:agentId/approve-tweet/:tweetId", async (req, res) => {
        const { agentId, tweetId } = req.params;
        const runtime = agents.get(agentId);

        if (!runtime) {
            res.status(404).json({ error: "Runtime not found" });
            return;
        }

        const twitterClient = runtime.clients.twitter as TwitterPostClient;
        const tweet = twitterClient.pendingTweets.get(tweetId);

        if (!tweet) {
            res.status(404).json({ error: "Tweet not found" });
            return;
        }

        try {
            if (tweet.type === 'reply') {
                await twitterClient.sendReply(tweet.content, tweet.replyToId);
            } else {
                await twitterClient.sendQuoteTweet(tweet.content, tweet.replyToId);
            }
            twitterClient.pendingTweets.delete(tweetId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: "Failed to send tweet" });
        }
    });

    return router;
}
