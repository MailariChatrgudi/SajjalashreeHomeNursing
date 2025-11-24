// form.js
const loader=document.getElementById("loader");
const popContent=document.getElementById("popupContent");
// Initialize EmailJS
(function () {
  emailjs.init("uHqIq6cgtZcGGsvPx"); // 🔹 Replace with your EmailJS Public Key //uHqIq6cgtZcGGsvP
})();

document.addEventListener("DOMContentLoaded", function () {
  // Select all form
  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      popContent.classList.toggle("d-none");
      loader.classList.toggle("d-none");

      // Gather inputs dynamically
      const inputs = form.querySelectorAll("input, textarea, select");
      
      // Validation for empty fields//
      let isValid=true;




      
      inputs.forEach((input)=>{
        if(input.hasAttribute("required") && input.value.trim()===""){
          isValid=false;
          input.classList.add("is-invalid");
        }
        else{
          input.classList.remove("is-invalid");
        } 
      });

      if(!isValid){
        alert("❌ Please fill all required fields.");
        loader.classList.toggle("d-none");
        popContent.classList.toggle("d-none");
        return;
      }
      
      
      let formData = {};
      inputs.forEach((input) => {
        const key =
          input.getAttribute("name") ||
          input.getAttribute("id") ||
          "field_" + Math.random().toString(36).substring(7);
        formData[key] = input.value;
      });

      // Detect form type
      let templateID = "";
      if (form.hasAttribute("data-product")) {
        templateID = "template_product_enquiry"; // Product enquiry
        formData.form_type = "Product Enquiry";
        formData.product_name = form.getAttribute("data-product");
      } 
      else  {
        templateID = "template_general_enquiry"; // General enquiry
        formData.form_type = "General Enquiry";
      }
      
      // Send email
      emailjs
        .send("service_nivhwmd", templateID, formData) //service_nivhwmd
        .then(
          function () {
            alert("✅ Thank you! Your enquiry has been sent successfully.");
            form.reset();
            inputs.forEach((input)=>input.value="");
            loader.classList.toggle("d-none");
            popContent.classList.toggle("d-none");
          },
          function (error) {
            alert("❌ Oops! Failed to send. Please try again.");
            console.error("FAILED...", error);
            inputs.forEach((input)=>input.value="");
            loader.classList.toggle("d-none");
            popContent.classList.toggle("d-none");
          }
        );
    });
  });
});


window.onload = function() {
  setTimeout(function() {
    document.getElementById("enquiryPopup").style.display = "flex";
  },3000);

};

// Close popup
function closePopup() {
  document.getElementById("enquiryPopup").style.display = "none";
}

