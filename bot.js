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

async function notifyLibrarian(message) {
  await bot.sendMessage(librarianChatId, message);
}

// Registration logic
bot.onText(/\/register/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ chatId });

  if (user) {
    return bot.sendMessage(
      chatId,
      `You are already registered as ${user.userName}.`
    );
  }

  registrationState[chatId] = { step: 1 }; // Step 1: Getting full name
  bot.sendMessage(chatId, "Please enter your full name:");
});

// When a user completes registration
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]?.step === 1) {
    const userName = msg.text; // User entered full name

    // Move to the next step
    registrationState[chatId].userName = userName; // Save the user's name
    registrationState[chatId].step = 2; // Step 2: Getting phone number
    bot.sendMessage(chatId, "Please enter your phone number:");
  } else if (registrationState[chatId]?.step === 2) {
    const phoneNumber = msg.text; // User entered phone number
    const user = await addUser(
      chatId,
      registrationState[chatId].userName,
      phoneNumber
    );

    // Notify librarian about the new registration
    await notifyLibrarian(
      `New registration: ${user.userName}, Phone: ${phoneNumber}`
    );

    bot.sendMessage(
      chatId,
      `✓ Registration successful! Welcome, ${user.userName}.`
    );
    askLanguageSelection(chatId);
    delete registrationState[chatId]; // Clear the registration state
  }
});

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

// Add user function
async function addUser(chatId, userName, phoneNumber) {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    user = new User({ userName, phoneNumber, chatId });
    await user.save();
  }
  return user;
}

// Handle language selection
async function handleLanguageSelection(chatId, language) {
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

// Handle category selection and list books
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (await isCategory(msg.text)) {
    const selectedCategory = msg.text;
    const books = await Book.find({
      category: selectedCategory,
      available: true,
    });

    if (books.length === 0) {
      return bot.sendMessage(
        chatId,
        `No available books in "${selectedCategory}".`
      );
    }

    const bookList = books
      .map((book) => `- "${book.title}" (ID: ${book.id})`)
      .join("\n");
    bot.sendMessage(
      chatId,
      `Available books in "${selectedCategory}":\n${bookList}\n\nTo reserve a book, type /reserve <ID>.`
    );
  }
});

// Function to check if the message is a valid category
async function isCategory(category) {
  const categories = await Book.distinct("category");
  return categories.includes(category);
}

bot.onText(/\/reserve (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];

  const user = await User.findOne({ chatId });
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
    pickupTime: "after isha salah", // Default pickup time
  });

  await reservation.save();
  book.available = false; // Mark the book as unavailable
  await book.save();

  // Notify librarian about the new reservation
  await notifyLibrarian(
    `New reservation by ${user.userName} for "${book.title}".`
  );

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
  const user = await User.findOne({ chatId });

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

// Check if the user is a librarian
const isLibrarian = (chatId) => {
  return chatId === librarianChatId; // Compare with the librarian's chat ID
};

// Librarian can cancel a reservation
bot.onText(/\/librarian_cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const reservationId = match[1];

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "You do not have permission to use this command."
    );
  }

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "Invalid reservation ID. Please check and try again."
    );
  }

  const book = await Book.findById(reservation.bookId);
  if (book) {
    book.available = true; // Mark the book as available again
    await book.save();
  }

  await Reservation.findByIdAndDelete(reservationId);
  bot.sendMessage(
    chatId,
    `Reservation for "${reservation.bookId.title}" has been successfully canceled.`
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
