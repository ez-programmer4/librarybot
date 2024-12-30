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

  ====================---====================
  🎉 *Welcome to the KJUMJ IRSHAD Library Booking Bot!* 📚
  
  Please register to get started by typing * /register *. ✍️
  
  For a list of all commands and guidance, type * /help *. ❓
  
  ====================---====================
  `;
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
});

// Registration state management
const userStates = {};

// Notify librarian
async function notifyLibrarian(message) {
  await bot.sendMessage(librarianChatId, message);
}

// Registration logic
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
      `🚫 You are already registered as *${existingUser.userName}*.`,
      { parse_mode: "Markdown" }
    );
  }

  userStates[chatId] = { step: 1 };
  console.log(`User ${chatId} is at step 1: asking for full name.`);
  bot.sendMessage(chatId, "📝 Please enter your full name:");
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
      return bot.sendMessage(chatId, "📞 Please enter your phone number:");
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
        `🆕 New registration: *${user.userName}*, Phone: *${phoneNumber}*`
      );
      bot.sendMessage(
        chatId,
        `✓ Registration successful! Welcome, *${user.userName}*! 🎉`
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
  bot.sendMessage(chatId, "🌐 Please select a language:", {
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
        `📚 *No available books* in "${selectedCategory}".`
      );
    }

    const bookList = books
      .map((book) => `🔖 *ID:* *${book.id}* - *"${book.title}"*`)
      .join("\n");

    bot.sendMessage(
      chatId,
      `📖 *Available books in* *"${selectedCategory}"*:\n\n${bookList}\n\nTo reserve a book, type /reserve <ID>.`,
      { parse_mode: "Markdown" }
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
      "🚫 You need to register first using /register."
    );
  }

  const book = await Book.findOne({ id: bookId });
  if (!book || !book.available) {
    console.log(`Book ID ${bookId} is not available for user ${chatId}.`);
    return bot.sendMessage(
      chatId,
      `❌ Sorry, the book with ID *${bookId}* is not available.`,
      { parse_mode: "Markdown" }
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
      `🆕 New reservation by *${user.userName}* for *"${book.title}"*.`
    );
    bot.sendMessage(
      chatId,
      `✅ Successfully reserved: *"${book.title}"*. Pickup time: *after isha salah*.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error saving reservation:", error);
    bot.sendMessage(
      chatId,
      "⚠️ There was an error processing your reservation. Please try again."
    );
  }
});

bot.onText(/\/add_books (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  // Check if the user is a librarian
  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to add books."
    );
  }

  const entries = match[1].split(";").map((entry) => entry.trim());

  for (const entry of entries) {
    const parts = entry.match(/^(\d+) (.+) "(.+)" "(.+)"$/); // Updated regex to allow any language
    if (!parts) {
      await bot.sendMessage(
        chatId,
        `❌ Invalid format for entry: *"${entry}".*`,
        { parse_mode: "Markdown" }
      );
      continue;
    }

    const id = parseInt(parts[1], 10);
    const language = parts[2].trim();
    const category = parts[3].trim();
    const title = parts[4].trim();

    const existingBook = await Book.findOne({ id });
    if (existingBook) {
      await bot.sendMessage(
        chatId,
        `🚫 A book with ID *${id}* already exists.`
      );
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
    await bot.sendMessage(chatId, `✅ Book *"${title}"* added successfully.`, {
      parse_mode: "Markdown",
    });
  }
});

bot.onText(/\/view_reservations/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "You do not have permission to use this command."
    );
  }

  const reservations = await Reservation.find().populate("userId bookId");
  if (reservations.length === 0) {
    return bot.sendMessage(chatId, "📅 There are no reservations.");
  }

  const reservationList = reservations
    .map(
      (res) =>
        `🔖 Book ID: *${res.bookId.id}* - User: *${res.userId.userName}* - Book: "${res.bookId.title}" - Pickup Time: *${res.pickupTime}*,`
    )
    .join("\n");

  bot.sendMessage(chatId, `📚 Current Reservations:\n\n${reservationList}`, {
    parse_mode: "Markdown",
  });
});
bot.onText(
  /\/librarian_add_reservation (\S+) (\d+) ?(.*)?/,
  async (msg, match) => {
    const chatId = msg.chat.id;

    // Check if the user is a librarian
    if (!isLibrarian(chatId)) {
      return bot.sendMessage(
        chatId,
        "🚫 You do not have permission to use this command."
      );
    }

    const userName = match[1]; // User name
    const bookId = match[2]; // Book ID (make sure this is numeric)
    const pickupTime = match[3] || "after isha salah"; // Optional pickup time

    // Check if the user is registered
    const user = await User.findOne({ userName });
    if (!user) {
      return bot.sendMessage(
        chatId,
        "👤 User not found. Registration is required before reserving a book."
      );
    }

    // Find the book by ID
    const book = await Book.findOne({ id: bookId });
    if (!book || !book.available) {
      return bot.sendMessage(
        chatId,
        `❌ Sorry, the book with ID *${bookId}* is not available.`,
        { parse_mode: "Markdown" }
      );
    }

    // Create the reservation
    const reservation = new Reservation({
      userId: user._id,
      bookId: book._id,
      pickupTime,
    });

    await reservation.save();
    book.available = false; // Mark the book as unavailable
    await book.save();

    await notifyLibrarian(
      `🆕 New manual reservation for *${user.userName}* for *"${book.title}"*.`
    );
    bot.sendMessage(
      chatId,
      `✅ Successfully added reservation for *${user.userName}* for *"${book.title}"*.`,
      { parse_mode: "Markdown" }
    );
  }
);

bot.onText(/\/librarian_cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1]; // This is the numeric ID of the book provided by the user

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to use this command."
    );
  }

  console.log(`Received book ID: ${bookId}`);

  // Find the book by its numeric ID
  const book = await Book.findOne({ id: bookId });
  if (!book) {
    return bot.sendMessage(
      chatId,
      "❌ No book found with the given ID. Please check and try again."
    );
  }

  // Find the reservation using the book's ObjectId
  const reservation = await Reservation.findOne({ bookId: book._id }).populate(
    "userId"
  );
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "❌ No reservation found for the given book ID. Please check and try again."
    );
  }

  // Mark the book as available again
  book.available = true; // Mark the book as available again
  await book.save();

  // Delete the reservation
  await Reservation.findByIdAndDelete(reservation._id);

  // Ensure to correctly access the title of the book
  bot.sendMessage(
    chatId,
    `✅ Reservation for *"${book.title}"* has been successfully canceled.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/change_language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🌐 Please select a language:", {
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
      bot.sendMessage(chatId, `✅ Language changed to *${msg.text}*.`, {
        parse_mode: "Markdown",
      });
    }
  }
});
// bot.onText(/\/cancel_own_reservation (\d+)/, async (msg, match) => {
//   const chatId = msg.chat.id;
//   const reservationId = match[1];

//   const user = await User.findOne({ chatId });
//   if (!user) {
//     return bot.sendMessage(
//       chatId,
//       "You need to register first using /register."
//     );
//   }

//   const reservation = await Reservation.findOne({
//     _id: reservationId,
//     userId: user._id,
//   });
//   if (!reservation) {
//     return bot.sendMessage(
//       chatId,
//       "You do not have a reservation with that ID."
//     );
//   }

//   const book = await Book.findById(reservation.bookId);
//   if (book) {
//     book.available = true; // Mark the book as available
//     await book.save();
//   }

//   await Reservation.findByIdAndDelete(reservationId);
//   bot.sendMessage(
//     chatId,
//     `You have successfully canceled your reservation for "${book.title}".`
//   );
// });
// Remove book from the database
bot.onText(/\/remove_book (\w+) (\w+) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  // Check if the user is a librarian
  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to remove books."
    );
  }

  const language = match[1].trim();
  const category = match[2].trim();
  const id = parseInt(match[3], 10);

  // Attempt to find and remove the book
  const book = await Book.findOneAndDelete({ id, language, category });
  if (!book) {
    return bot.sendMessage(
      chatId,
      `❌ No book found with ID *${id}* in category *"${category}".*`,
      { parse_mode: "Markdown" }
    );
  }

  bot.sendMessage(
    chatId,
    `✅ Book with ID *${id}* has been removed from category *"${category}"* in *${language}*.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/my_reservations/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ chatId });

  if (!user) {
    return bot.sendMessage(
      chatId,
      "🚫 You need to register first using /register."
    );
  }

  const userReservations = await Reservation.find({
    userId: user._id,
  }).populate("bookId");

  if (userReservations.length === 0) {
    return bot.sendMessage(chatId, "📭 You currently have no reservations.");
  }

  const reservationList = userReservations
    .map((res, index) => {
      // Escape all Markdown special characters
      const title = res.bookId.title.replace(/([_*~`>#+\-.!])/g, "\\$1");
      const pickupTime = res.pickupTime.replace(/([_*~`>#+\-.!])/g, "\\$1");
      return `📝 Reservation #${
        index + 1
      }: *${title}* (Pickup: *${pickupTime}*)`;
    })
    .join("\n");

  // Log the final message for debugging
  console.log(
    "Final Message:",
    `📖 *Your Reservations:*\n${reservationList}\n\nTo cancel a reservation, use /cancel_reservation <number>.`
  );

  try {
    // Send message as plain text for testing
    await bot.sendMessage(
      chatId,
      `📖 Your Reservations:\n${reservationList}\n\nTo cancel a reservation, use /cancel_reservation <number>.`
    );
  } catch (error) {
    console.error("Error sending message:", error);
    await bot.sendMessage(
      chatId,
      "❌ An error occurred while retrieving your reservations. Please try again."
    );
  }
});

// Cancel reservation by reservation number
bot.onText(/\/cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const reservationIndex = parseInt(match[1]) - 1; // Convert to zero-based index

  const user = await User.findOne({ chatId });
  if (!user) {
    return bot.sendMessage(
      chatId,
      "🚫 You need to register first using /register."
    );
  }

  const userReservations = await Reservation.find({
    userId: user._id,
  }).populate("bookId");

  if (reservationIndex < 0 || reservationIndex >= userReservations.length) {
    return bot.sendMessage(
      chatId,
      "❌ Invalid reservation number. Please check your reservations and try again."
    );
  }

  const reservation = userReservations[reservationIndex];

  const book = await Book.findById(reservation.bookId);
  if (book) {
    book.available = true; // Mark the book as available again
    await book.save();
  }

  await Reservation.findByIdAndDelete(reservation._id);
  bot.sendMessage(
    chatId,
    `✅ You have successfully canceled the reservation for *"${reservation.bookId.title}"*.`,
    { parse_mode: "Markdown" }
  );

  // Notify the librarian about the cancellation
  const librarianChatId = "YOUR_LIBRARIAN_CHAT_ID"; // Replace with the actual chat ID
  bot.sendMessage(
    librarianChatId,
    `📩 User has canceled a reservation:\n- *Title:* *"${
      reservation.bookId.title
    }"*\n- *User ID:* *${user._id}*\n- *Reservation Number:* *${
      reservationIndex + 1
    }*`,
    { parse_mode: "Markdown" }
  );
});

// Check if the user is a librarian
const isLibrarian = (chatId) => {
  return chatId == librarianChatId; // Compare with the librarian's chat ID
};

// Librarian can cancel a reservation
bot.onText(/\/librarian_cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1]; // This is the numeric ID of the book provided by the user

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to use this command."
    );
  }

  // Find the book by its numeric ID
  const book = await Book.findOne({ id: bookId });
  if (!book) {
    return bot.sendMessage(
      chatId,
      "❌ No book found with the given ID. Please check and try again."
    );
  }

  // Find the reservation by book ID using the book's ObjectId
  const reservation = await Reservation.findOne({ bookId: book._id }).populate(
    "userId"
  );
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "❌ No reservation found for the given book ID. Please check and try again."
    );
  }

  // Mark the book as available again
  book.available = true;
  await book.save();

  // Delete the reservation
  await Reservation.findByIdAndDelete(reservation._id);
  bot.sendMessage(
    chatId,
    `✅ Reservation for *"${reservation.bookId.title}"* has been successfully canceled.`,
    { parse_mode: "Markdown" }
  );
});
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
  🤖 *Library Bot Help*

  Here are the commands you can use:

  - /register: Register yourself to start using the library services.
  - /remove_book <language> <category> <id>: Remove a book from the library.
  - /librarian_add_reservation <username> <book_id> [pickup_time]: Manually add a reservation for a user.
  - /librarian_cancel_reservation <book_id>: Cancel a reservation for a book.
  - /my_reservations: View your current reservations.
  - /cancel_reservation <number>: Cancel a specific reservation by its number.
  - /change_language: Change your preferred language.

  For more assistance, feel free to ask questions! 📚
  `;

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
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
