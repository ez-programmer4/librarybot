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

// Registration state management
const userStates = {};

// Notify librarian
async function notifyLibrarian(message) {
  await bot.sendMessage(librarianChatId, message);
}

// Registration logic
bot.onText(/\/register/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`User ${chatId} initiated registration.`);

  const existingUser = await User.findOne({ chatId });
  if (existingUser) {
    console.log(
      `User ${chatId} is already registered as ${existingUser.userName}.`
    );
    return bot.sendMessage(
      chatId,
      `You are already registered as ${existingUser.userName}.`
    );
  }

  userStates[chatId] = { step: 1 };
  console.log(`User ${chatId} is at step 1: asking for full name.`);
  bot.sendMessage(chatId, "Please enter your full name:");
});

// Handle user messages during registration and other commands
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received message from ${chatId}: ${msg.text}`);

  // Ensure the message is not a command
  if (msg.text.startsWith("/")) return;

  if (userStates[chatId]) {
    if (userStates[chatId].step === 1) {
      userStates[chatId].userName = msg.text;
      userStates[chatId].step = 2;
      console.log(`User ${chatId} provided full name: ${msg.text}`);
      return bot.sendMessage(chatId, "Please enter your phone number:");
    } else if (userStates[chatId].step === 2) {
      const phoneNumber = msg.text;
      console.log(`User ${chatId} provided phone number: ${phoneNumber}`);

      const user = await addUser(
        chatId,
        userStates[chatId].userName,
        phoneNumber
      );
      console.log(
        `User ${chatId} registered with name: ${user.userName}, phone: ${phoneNumber}`
      );

      await notifyLibrarian(
        `New registration: ${user.userName}, Phone: ${phoneNumber}`
      );
      bot.sendMessage(
        chatId,
        `✓ Registration successful! Welcome, ${user.userName}.`
      );
      delete userStates[chatId]; // Clear the registration state
      return askLanguageSelection(chatId);
    }
  }

  // Handle language selection or other commands
  if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    return handleLanguageSelection(chatId, msg.text);
  } else if (msg.text === "/change_language") {
    return askLanguageSelection(chatId);
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

async function addUser(chatId, userName, phoneNumber) {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    user = new User({ userName, phoneNumber, chatId }); // Ensure chatId is included
    await user.save();
    console.log(
      `New user created: ${user.userName}, Phone: ${phoneNumber}, Chat ID: ${chatId}`
    );
  } else {
    console.log(
      `User with phone number ${phoneNumber} already exists. Returning existing user.`
    );
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

// Reservation logic
bot.onText(/\/reserve (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];
  console.log(`User ${chatId} requested to reserve book ID: ${bookId}`);

  // Ensure chatId is correctly looked up
  const user = await User.findOne({ chatId: chatId });
  console.log("User object:", user);
  if (!user) {
    console.log(`User ${chatId} is not registered.`);
    return bot.sendMessage(
      chatId,
      "You need to register first using /register."
    );
  }

  const book = await Book.findOne({ id: bookId });
  if (!book || !book.available) {
    console.log(`Book ID ${bookId} is not available for user ${chatId}.`);
    return bot.sendMessage(
      chatId,
      `Sorry, the book with ID ${bookId} is not available.`
    );
  }

  try {
    const reservation = new Reservation({
      userId: user._id,
      bookId: book._id,
      pickupTime: "after isha salah",
    });

    await reservation.save();
    book.available = false; // Mark the book as unavailable
    await book.save();

    await notifyLibrarian(
      `New reservation by ${user.userName} for "${book.title}".`
    );
    bot.sendMessage(
      chatId,
      `Successfully reserved: "${book.title}". Pickup time: after isha salah.`
    );
  } catch (error) {
    console.error("Error saving reservation:", error);
    bot.sendMessage(
      chatId,
      "There was an error processing your reservation. Please try again."
    );
  }
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

bot.onText(/\/view_reservations/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(chatId);
  console.log(librarianChatId);
  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "You do not have permission to use this command."
    );
  }

  const reservations = await Reservation.find().populate("userId bookId");
  if (reservations.length === 0) {
    return bot.sendMessage(chatId, "There are no reservations.");
  }

  const reservationList = reservations
    .map(
      (res) =>
        `User: ${res.userId.userName}, Book: "${res.bookId.title}", Pickup Time: ${res.pickupTime}`
    )
    .join("\n");

  bot.sendMessage(chatId, `Current Reservations:\n${reservationList}`);
});
bot.onText(/\/librarian_add_reservation (.+) (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "You do not have permission to use this command."
    );
  }

  const userName = match[1]; // User name
  const bookId = match[2]; // Book ID
  const pickupTime = match[3] || "after isha salah"; // Optional pickup time

  const user = await User.findOne({ userName });
  const book = await Book.findOne({ id: bookId });

  if (!user) {
    return bot.sendMessage(chatId, "User not found.");
  }

  if (!book || !book.available) {
    return bot.sendMessage(
      chatId,
      `Sorry, the book with ID ${bookId} is not available.`
    );
  }

  const reservation = new Reservation({
    userId: user._id,
    bookId: book._id,
    pickupTime,
  });

  await reservation.save();
  book.available = false; // Mark the book as unavailable
  await book.save();

  await notifyLibrarian(
    `New manual reservation for ${user.userName} for "${book.title}".`
  );
  bot.sendMessage(
    chatId,
    `Successfully added reservation for ${user.userName} for "${book.title}".`
  );
});
bot.onText(/\/librarian_cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "You do not have permission to use this command."
    );
  }

  const reservationId = match[1];
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    return bot.sendMessage(chatId, "Invalid reservation ID.");
  }

  const book = await Book.findById(reservation.bookId);
  if (book) {
    book.available = true; // Mark the book as available again
    await book.save();
  }

  await Reservation.findByIdAndDelete(reservationId);
  bot.sendMessage(
    chatId,
    `Reservation with ID ${reservationId} has been successfully canceled.`
  );
});
bot.onText(/\/change_language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Please select a language:", {
    reply_markup: {
      keyboard: [["Arabic"], ["Amharic"], ["AfaanOromo"]],
      one_time_keyboard: true,
    },
  });
});

// Handle language selection
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    // Assuming you have a user object to save the language preference
    const user = await User.findOne({ chatId });
    if (user) {
      user.language = msg.text; // Save the selected language
      await user.save();
      bot.sendMessage(chatId, `Language changed to ${msg.text}.`);
    }
  }
});
bot.onText(/\/cancel_own_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const reservationId = match[1];

  const user = await User.findOne({ chatId });
  if (!user) {
    return bot.sendMessage(
      chatId,
      "You need to register first using /register."
    );
  }

  const reservation = await Reservation.findOne({
    _id: reservationId,
    userId: user._id,
  });
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "You do not have a reservation with that ID."
    );
  }

  const book = await Book.findById(reservation.bookId);
  if (book) {
    book.available = true; // Mark the book as available
    await book.save();
  }

  await Reservation.findByIdAndDelete(reservationId);
  bot.sendMessage(
    chatId,
    `You have successfully canceled your reservation for "${book.title}".`
  );
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
  return chatId == librarianChatId; // Compare with the librarian's chat ID
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

// Set webhook on startup
setWebhook().catch(console.error);

// Error handling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Error occurred:", error);
});
