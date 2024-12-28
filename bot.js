const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const { User, Book, Reservation } = require("./models");

const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;

// Replace with your bot's API token
const token = process.env.TOKEN;
const bot = new TelegramBot(token);
const librarianChatId = process.env.LIBRARIAN_CHAT_ID.trim();

// Database connection
async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    setTimeout(connectToDatabase, 5000);
  }
}

// Initialize database connection
connectToDatabase();

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
      ================---==============
    Welcome to the KJUMJ IRSHAD Library Booking Bot! 📚
    Please register to get started by typing /register.
    
    For a list of all commands and guidance, type /help.
    ================---==============
    `;
  bot.sendMessage(chatId, welcomeMessage);
});

// Registration logic
let registrationState = {};

bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (registrationState[chatId]) {
    return bot.sendMessage(
      chatId,
      "You are already in the registration process."
    );
  }

  registrationState[chatId] = { step: 1 };
  bot.sendMessage(chatId, "Please enter your full name:");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Step 1: Capture the user's name
  if (registrationState[chatId]?.step === 1) {
    registrationState[chatId].userName = msg.text;
    registrationState[chatId].step = 2;
    return bot.sendMessage(chatId, "Please enter your phone number:");
  }

  // Step 2: Capture the user's phone number
  if (registrationState[chatId]?.step === 2) {
    const phoneNumber = msg.text;
    try {
      const user = await addUser(
        chatId,
        registrationState[chatId].userName,
        phoneNumber
      );
      bot.sendMessage(
        chatId,
        `✓ Registration successful! Welcome, ${user.userName}.`
      );
      delete registrationState[chatId];
    } catch (error) {
      console.error("Error adding user:", error);
      bot.sendMessage(
        chatId,
        "There was an error during registration. Please try again."
      );
    }
  }
});

// Add user function
async function addUser(chatId, userName, phoneNumber) {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    user = new User({ userName, phoneNumber });
    await user.save();
  }
  return user;
}

// Ask for language selection
function askLanguageSelection(chatId) {
  bot.sendMessage(chatId, "Please select a language:", {
    reply_markup: {
      keyboard: [["Arabic"], ["Amharic"], ["AfaanOromo"]],
      one_time_keyboard: true,
    },
  });
}

// Handle language selection
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]) {
    // Handle registration process
  } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    await handleLanguageSelection(chatId, msg.text);
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});

// Handle category selection
async function handleLanguageSelection(chatId, language) {
  // Fetch categories from the database
  const categories = await Book.distinct("category", { language });
  if (categories.length === 0) {
    return bot.sendMessage(chatId, `No categories available for ${language}.`);
  }

  bot.sendMessage(
    chatId,
    `You selected ${language}. Please choose a category:`,
    {
      reply_markup: {
        keyboard: categories.map((cat) => [cat]),
        one_time_keyboard: true,
      },
    }
  );
}

// Handle book listing and reservation
bot.onText(/\/reserve (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];

  const user = await User.findOne({ phoneNumber: chatId });
  if (!user) {
    return bot.sendMessage(
      chatId,
      "You need to register first using /register."
    );
  }

  const book = await Book.findOne({ id: bookId });
  if (!book || !book.available) {
    return bot.sendMessage(
      chatId,
      `Sorry, the book with ID ${bookId} is not available.`
    );
  }

  const reservation = new Reservation({
    userId: user._id,
    bookId: book._id,
    pickupTime: "after isha salah",
  });

  await reservation.save();
  book.available = false;
  await book.save();

  return bot.sendMessage(
    chatId,
    `Successfully reserved: "${book.title}". Pickup time: after isha salah.`
  );
});

// Adding books to the database
bot.onText(/\/add_books (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const entries = match[1].split(";").map((entry) => entry.trim());

  for (const entry of entries) {
    const parts = entry.match(/^(\d+) (\w+) "(.+)" "(.+)"$/);
    if (!parts) {
      await bot.sendMessage(chatId, `Invalid format for entry: "${entry}".`);
      continue;
    }

    const id = parseInt(parts[1], 10);
    const language = parts[2].trim();
    const category = parts[3].trim();
    const title = parts[4].trim();

    // Check if the language exists
    const existingBook = await Book.findOne({ id });
    if (existingBook) {
      await bot.sendMessage(chatId, `A book with ID ${id} already exists.`);
      continue;
    }

    const newBook = new Book({
      id,
      title,
      available: true,
      language,
      category,
    });
    await newBook.save();
    await bot.sendMessage(chatId, `Book "${title}" added successfully.`);
  }
});

// Remove book from the database
bot.onText(/\/remove_book (\w+) (\w+) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const language = match[1].trim();
  const category = match[2].trim();
  const id = parseInt(match[3], 10);

  const book = await Book.findOneAndDelete({ id, language, category });
  if (!book) {
    return bot.sendMessage(
      chatId,
      `No book found with ID ${id} in category "${category}".`
    );
  }

  bot.sendMessage(
    chatId,
    `Book with ID ${id} has been removed from category "${category}" in ${language}.`
  );
});

// View own reservations
bot.onText(/\/my_reservations/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ phoneNumber: chatId });

  if (!user) {
    return bot.sendMessage(
      chatId,
      "You need to register first using /register."
    );
  }

  const userReservations = await Reservation.find({
    userId: user._id,
  }).populate("bookId");
  if (userReservations.length === 0) {
    return bot.sendMessage(chatId, "You currently have no reservations.");
  }

  const reservationList = userReservations
    .map((res) => `- "${res.bookId.title}" (Pickup: ${res.pickupTime})`)
    .join("\n");

  bot.sendMessage(chatId, `Your Reservations:\n${reservationList}`);
});

// Cancel a reservation by ID
bot.onText(/\/cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const reservationId = match[1];

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "Invalid reservation ID. Please check your reservations and try again."
    );
  }

  const book = await Book.findById(reservation.bookId);
  if (book) {
    book.available = true;
    await book.save();
  }

  await Reservation.findByIdAndDelete(reservationId);
  bot.sendMessage(
    chatId,
    `You have successfully canceled the reservation for "${reservation.bookId.title}".`
  );
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Set the webhook URL
const setWebhook = async () => {
  const url = `https://librarybot-qx3c.onrender.com/webhook`;
  await bot.setWebHook(url);
};

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

setWebhook().catch(console.error);

// Error handling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Error occurred:", error);
});
