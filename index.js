const express = require("express");
const app = express();
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const fs = require("fs").promises;
const { google } = require("googleapis");

const port = 8080;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];

const labelName = "Vacation Auto-Reply";

app.get("/", async (req, res) => {
  try {
    console.log("Authenticating...");
    const auth = await authenticate({
      keyfilePath: path.join(__dirname, "credentials.json"),
      scopes: SCOPES,
    });
    console.log("Authentication successful");

    const gmail = google.gmail({ version: "v1", auth });

    console.log("Getting labels...");
    const response = await gmail.users.labels.list({
      userId: "me",
    });
    const labels = response.data.labels;
    console.log("Labels retrieved:", labels);

    console.log("Creating or retrieving label...");
    const labelId = await createLabel(auth);
    console.log("Label ID:", labelId);

    console.log("Setting up interval...");
    setInterval(async () => {
      console.log("Checking for unreplied messages...");
      const messages = await getUnrepliesMessages(auth);
      console.log("Unreplied messages:", messages);

      if (messages && messages.length > 0) {
        for (const message of messages) {
          console.log("Processing message:", message);
          const messageData = await gmail.users.messages.get({
            auth,
            userId: "me",
            id: message.id,
          });

          const email = messageData.data;
          const hasReplied = email.payload.headers.some(
            (header) => header.name === "In-Reply-To"
          );

          if (!hasReplied) {
            console.log("Crafting reply message...");
            const replyMessage = {
              userId: "me",
              resource: {
                raw: Buffer.from(
                  `To: ${email.payload.headers.find(
                    (header) => header.name === "From"
                  ).value
                  }\r\n` +
                  `Subject: Re: ${email.payload.headers.find(
                    (header) => header.name === "Subject"
                  ).value
                  }\r\n` +
                  `Content-Type: text/plain; charset="UTF-8"\r\n` +
                  `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                  `Thank you for your email. I'm currently on vacation and will reply to you when I return.\r\n`
                ).toString("base64"),
              },
            };

            console.log("Sending reply message...");
            const sendResponse = await gmail.users.messages.send(replyMessage);
            console.log("Send response:", sendResponse);

            console.log("Modifying labels and moving email...");
            const modifyResponse = await gmail.users.messages.modify({
              auth,
              userId: "me",
              id: message.id,
              resource: {
                addLabelIds: [labelId],
                removeLabelIds: ["INBOX"],
              },
            });
            console.log("Modify response:", modifyResponse);

            console.log("Reply sent and labels modified.");
          }
        }
      }
    }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);

    res.json({ "Authentication status": "Success", "Label ID": labelId });
  } catch (error) {
    console.error("Error:", error);
    res.json({ "Authentication status": "Failed", "Error": error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function getUnrepliesMessages(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  const response = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX"],
    q: "is:unread",
  });
  return response.data.messages || [];
}

async function createLabel(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  try {
    const response = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    return response.data.id;
  } catch (error) {
    if (error.code === 409) {
      const response = await gmail.users.labels.list({
        userId: "me",
      });
      const label = response.data.labels.find(
        (label) => label.name === labelName
      );
      return label.id;
    } else {
      throw error;
    }
  }
}
